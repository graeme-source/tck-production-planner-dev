/**
 * Which goods-in delivery each invoice was for (Graeme, 13 Nov 2026) — a
 * soft check, one supplier at a time. Pure; no database.
 *
 * Not a reconciliation. Invoices often come days or weeks either side of the
 * delivery, so the rules are deliberately gentle:
 *  - an invoice pairs with at most one delivery, and a delivery with at most
 *    one invoice, nearest the supplier's usual gap first;
 *  - when the invoice's lines have been read, a pair must share at least one
 *    item, and the quantities are compared (within QTY_TOLERANCE, or within
 *    the supplier's usual ratio once it has shown it three times — Puffin
 *    counts 2 liners for every 1 we record);
 *  - when the lines haven't been read, a pair is by date alone and only when
 *    it is close to the usual gap ("matched by date");
 *  - an invoice with no delivery is only a warning once it is older than
 *    lateAfterDays: two weeks, or the supplier's usual gap plus a week if
 *    that is longer. Before that it's simply "waiting".
 * Being invoiced for LESS than arrived is never a warning.
 */

export interface MatchInvoiceLine {
  ingredientId: number | null;
  /** Quantity in the ingredient's own unit (each / kg / roll …). */
  nativeQty: number | null;
  isCharge: boolean;
}

export interface MatchInvoice {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  number: string | null;
  total: number | null;
  /** null = lines not read (pair by date only). */
  lines: MatchInvoiceLine[] | null;
}

export interface MatchDeliveryLine {
  ingredientId: number;
  nativeQty: number;
  /** Sold by weight (kg, g, l): the invoice is on the real weight, goods-in often records what was ordered. */
  weighed?: boolean;
}

export interface MatchDelivery {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  lines: MatchDeliveryLine[];
}

export type InvoiceMatchStatus =
  | "matched"
  | "matched_by_date"
  | "quantity_differs"
  | "waiting"
  | "no_delivery";

export interface QuantityDifference {
  ingredientId: number;
  invoiced: number;
  received: number;
}

export interface InvoiceMatch {
  invoiceId: number;
  status: InvoiceMatchStatus;
  deliveryId: number | null;
  /** Delivery date minus invoice date, in days (negative = delivered first). */
  gapDays: number | null;
  ageDays: number;
  differences: QuantityDifference[];
  /** An unpaired invoice for the same amount as another nearby one. */
  sameAsInvoiceId: number | null;
  /** Far bigger than this supplier's usual invoice, and not confirmed by quantities. */
  unusualAmount: boolean;
}

export interface SupplierMatchProfile {
  /** Median delivery-minus-invoice gap of confirmed pairs (null = not enough yet). */
  typicalGapDays: number | null;
  lateAfterDays: number;
  confirmedPairs: number;
  /** Ingredient → invoice quantity per unit we record, where it is not 1. */
  usualRatios: Record<number, number>;
}

export interface SupplierMatchResult {
  profile: SupplierMatchProfile;
  invoices: InvoiceMatch[];
  /** Delivery id → invoice id (null = no invoice yet). */
  deliveryInvoice: Record<number, number | null>;
}

/** Counted items: a few over is rounding. */
export const QTY_TOLERANCE = 0.06;
/** Weights arrive a little over (20 kg ordered, 20.3–21 kg sent), and goods-in often types what was ordered. */
export const WEIGHT_TOLERANCE = 0.1;
export const WEIGHT_SLACK = 0.25;
/** A pair further than this from the usual gap needs the quantities to agree exactly. */
const FAR_DAYS = 7;
/** How far a delivery can be from its invoice: delivered up to 35 days before, up to 28 days after. */
export const EARLIEST_GAP = -35;
export const LATEST_GAP = 28;
export const MIN_LATE_AFTER_DAYS = 14;
const MIN_SAMPLES = 3;
const SAME_AMOUNT_WINDOW_DAYS = 21;
const UNUSUAL_AMOUNT_FACTOR = 1.8;

export function dayNumber(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`Not a date: "${iso}"`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function near(a: number, b: number): boolean {
  return b > 0 && Math.abs(a / b - 1) <= QTY_TOLERANCE;
}

/** Goods on the invoice by ingredient, in our units; null = can't compare. */
function invoiceGoods(inv: MatchInvoice): Map<number, number> | null {
  if (!inv.lines) return null;
  const goods = new Map<number, number>();
  for (const l of inv.lines) {
    if (l.isCharge || l.ingredientId == null || l.nativeQty == null || !(l.nativeQty > 0)) continue;
    goods.set(l.ingredientId, (goods.get(l.ingredientId) ?? 0) + l.nativeQty);
  }
  return goods.size > 0 ? goods : null;
}

interface Received { qty: number; weighed: boolean }

function deliveryGoods(d: MatchDelivery): Map<number, Received> {
  const goods = new Map<number, Received>();
  for (const l of d.lines) {
    if (!(l.nativeQty > 0)) continue;
    const cur = goods.get(l.ingredientId);
    goods.set(l.ingredientId, { qty: (cur?.qty ?? 0) + l.nativeQty, weighed: Boolean(cur?.weighed || l.weighed) });
  }
  return goods;
}

function withinTolerance(invoiced: number, r: Received): boolean {
  return r.weighed
    ? invoiced <= r.qty * (1 + WEIGHT_TOLERANCE) + WEIGHT_SLACK
    : invoiced <= r.qty * (1 + QTY_TOLERANCE);
}

interface Candidate {
  inv: MatchInvoice;
  del: MatchDelivery;
  gap: number;
  /** null = date only. */
  differences: QuantityDifference[] | null;
  /** How far apart the two are, item by item (0 = the same goods in the same amounts). */
  mismatch: number;
}

function compare(
  invGoods: Map<number, number>,
  delGoods: Map<number, Received>,
  ratios: Record<number, number>,
): { differences: QuantityDifference[]; mismatch: number } | "no_overlap" {
  let overlap = false;
  let mismatch = 0;
  const differences: QuantityDifference[] = [];
  for (const [ingredientId, invoiced] of invGoods) {
    const r = delGoods.get(ingredientId);
    const ratio = ratios[ingredientId];
    if (!r) {
      mismatch += 1;
      differences.push({ ingredientId, invoiced, received: 0 });
      continue;
    }
    overlap = true;
    const off = Math.min(Math.abs(Math.log(invoiced / r.qty)), ratio ? Math.abs(Math.log(invoiced / (r.qty * ratio))) : Infinity);
    mismatch += Math.min(off, 3);
    if (withinTolerance(invoiced, r)) continue;
    if (ratio && near(invoiced / r.qty, ratio)) continue;
    differences.push({ ingredientId, invoiced, received: r.qty });
  }
  for (const id of delGoods.keys()) if (!invGoods.has(id)) mismatch += 0.3;
  return overlap ? { differences, mismatch } : "no_overlap";
}

function candidates(
  invoices: MatchInvoice[],
  deliveries: MatchDelivery[],
  ratios: Record<number, number>,
  typical: number,
  dateOnlySlack: number,
): Candidate[] {
  const out: Candidate[] = [];
  const delGoods = new Map(deliveries.map((d) => [d.id, deliveryGoods(d)]));
  for (const inv of invoices) {
    const goods = invoiceGoods(inv);
    const invDay = dayNumber(inv.date);
    for (const del of deliveries) {
      const gap = dayNumber(del.date) - invDay;
      if (gap < EARLIEST_GAP || gap > LATEST_GAP) continue;
      if (!goods) {
        if (Math.abs(gap - typical) > dateOnlySlack) continue;
        out.push({ inv, del, gap, differences: null, mismatch: 0 });
        continue;
      }
      const c = compare(goods, delGoods.get(del.id)!, ratios);
      if (c === "no_overlap") continue;
      // Far from the usual gap, only the very same goods count as a pair.
      if (Math.abs(gap - typical) > FAR_DAYS && (c.differences.length > 0 || c.mismatch > 0.15)) continue;
      out.push({ inv, del, gap, ...c });
    }
  }
  return out;
}

/** One-to-one, best first: nearest the usual gap, with the closest goods and amounts. */
function assign(cands: Candidate[], typical: number): Map<number, Candidate> {
  const score = (c: Candidate) =>
    Math.abs(c.gap - typical) + 4 * c.mismatch + (c.differences === null ? 2 : c.differences.length > 0 ? 8 : 0);
  const sorted = [...cands].sort((a, b) => score(a) - score(b) || a.inv.id - b.inv.id || a.del.id - b.del.id);
  const byInvoice = new Map<number, Candidate>();
  const usedDeliveries = new Set<number>();
  for (const c of sorted) {
    if (byInvoice.has(c.inv.id) || usedDeliveries.has(c.del.id)) continue;
    byInvoice.set(c.inv.id, c);
    usedDeliveries.add(c.del.id);
  }
  return byInvoice;
}

/**
 * Invoice quantity ÷ what we recorded, per ingredient, where the same
 * ratio (not 1) turns up at least three times and in most pairs.
 */
function learnRatios(pairs: Candidate[]): Record<number, number> {
  const samples = new Map<number, number[]>();
  for (const p of pairs) {
    const goods = invoiceGoods(p.inv);
    if (!goods) continue;
    const del = deliveryGoods(p.del);
    for (const [id, invoiced] of goods) {
      const received = del.get(id)?.qty;
      if (!received) continue;
      samples.set(id, [...(samples.get(id) ?? []), invoiced / received]);
    }
  }
  const ratios: Record<number, number> = {};
  for (const [id, xs] of samples) {
    const m = median(xs)!;
    if (near(m, 1)) continue;
    const agreeing = xs.filter((x) => near(x, m)).length;
    if (agreeing >= MIN_SAMPLES && agreeing / xs.length >= 0.6) ratios[id] = Math.round(m * 1000) / 1000;
  }
  return ratios;
}

export function matchSupplierInvoices(
  invoices: MatchInvoice[],
  deliveries: MatchDelivery[],
  today: string,
): SupplierMatchResult {
  // Pass 1: nearest by date with the quantities as they are, to learn this
  // supplier's usual ratios and gap. Pass 2: the real pairing.
  const first = assign(candidates(invoices, deliveries, {}, 0, 3), 0);
  const ratios = learnRatios([...first.values()]);
  const second = assign(candidates(invoices, deliveries, ratios, 0, 3), 0);
  const confirmedGaps = [...second.values()].filter((c) => c.differences?.length === 0).map((c) => c.gap);
  // No lines read yet: the date-only pairs still say what's usual.
  const gaps = confirmedGaps.length >= MIN_SAMPLES ? confirmedGaps : [...second.values()].filter((c) => c.differences === null).map((c) => c.gap);
  const typical = gaps.length >= MIN_SAMPLES ? median(gaps)! : null;
  // Most pairs' distance from the usual (three in four), so one odd pair doesn't stretch it.
  const spread = typical == null ? 3 : Math.max(2, ...gaps.map((g) => Math.abs(g - typical)).sort((a, b) => a - b).slice(0, Math.ceil(gaps.length * 0.75)));
  const pairs = typical == null ? second : assign(candidates(invoices, deliveries, ratios, typical, Math.min(spread, 7)), typical);

  const lateAfterDays = Math.max(MIN_LATE_AFTER_DAYS, Math.ceil((typical ?? 0) + spread + 7));
  const totals = invoices.map((i) => i.total).filter((t): t is number => t != null && t > 0);
  const usualTotal = totals.length >= 5 ? median(totals) : null;
  const todayDay = dayNumber(today);

  const matches: InvoiceMatch[] = invoices.map((inv) => {
    const p = pairs.get(inv.id);
    const ageDays = todayDay - dayNumber(inv.date);
    const status: InvoiceMatchStatus = p
      ? p.differences === null ? "matched_by_date" : p.differences.length === 0 ? "matched" : "quantity_differs"
      : ageDays > lateAfterDays ? "no_delivery" : "waiting";
    let sameAsInvoiceId: number | null = null;
    if (!p && inv.total != null) {
      const twin = invoices.find((o) => o.id !== inv.id && o.total != null && Math.abs(o.total - inv.total!) < 0.005
        && Math.abs(dayNumber(o.date) - dayNumber(inv.date)) <= SAME_AMOUNT_WINDOW_DAYS && pairs.has(o.id));
      sameAsInvoiceId = twin?.id ?? null;
    }
    const unusualAmount = usualTotal != null && inv.total != null && inv.total > usualTotal * UNUSUAL_AMOUNT_FACTOR && status !== "matched";
    return {
      invoiceId: inv.id, status, deliveryId: p?.del.id ?? null, gapDays: p?.gap ?? null, ageDays,
      differences: p?.differences ?? [], sameAsInvoiceId, unusualAmount,
    };
  });

  const deliveryInvoice: Record<number, number | null> = {};
  for (const d of deliveries) deliveryInvoice[d.id] = null;
  for (const [invoiceId, c] of pairs) deliveryInvoice[c.del.id] = invoiceId;

  return {
    profile: { typicalGapDays: typical, lateAfterDays, confirmedPairs: confirmedGaps.length, usualRatios: ratios },
    invoices: matches,
    deliveryInvoice,
  };
}

/** Worth a gentle amber on screen. */
export function needsALook(m: InvoiceMatch): boolean {
  return m.status === "no_delivery" || m.status === "quantity_differs" || m.unusualAmount;
}

/**
 * A goods-in line's quantity in the ingredient's own unit. Pack counts are
 * multiplied by the pack size like stock is (lib/goods-in-stock); a pallet
 * is pallet_size packs (older goods-in records were typed as "1 pallet").
 */
export function deliveredNativeQty(
  qty: number,
  lineUnit: string | null,
  packWeight: number,
  palletSize: number | null,
): number {
  const pack = packWeight > 0 ? packWeight : 1;
  if (lineUnit === "pallets") return qty * (palletSize && palletSize > 0 ? palletSize : 1) * pack;
  if (lineUnit === "packs" || lineUnit === "bottles") return qty * pack;
  return qty;
}
