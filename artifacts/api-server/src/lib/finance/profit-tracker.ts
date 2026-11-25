/**
 * Profit tracker — what each order and each period SHOULD have made, from
 * our own costings, laid out like the QuickBooks P&L so the two can be set
 * side by side (Graeme, 18 Nov 2026; Objective I, finance & reporting).
 * Pure; the loading is in profit-tracker-load.ts.
 *
 * Purpose, in his words: see "in the last 2 weeks, this is roughly the profit
 * we're making" — e.g. whether a discount offer pays — without waiting five
 * weeks for the month's books.
 *
 * The rules (docs/PNL_QUICKBOOKS_MAPPING.md):
 *  - Revenue is counted on the day the order is PLACED (London), as
 *    QuickBooks books it: total_price − VAT − refunds. Shipping charged is
 *    part of it, as in QuickBooks.
 *  - Food = recipe ingredient cost per pack (inventory prices, kept current
 *    from invoices); items without a recipe use Shopify's cost per item.
 *  - Packaging = the recipe's packaging (tray, film, label) PLUS the box
 *    (outer box, insulation, ice). QuickBooks has ONE packaging line, so the
 *    two halves are added, never split into food.
 *  - Courier = flat price per parcel by box size. Collections and our own
 *    van deliveries have none.
 *  - Payment fees = QuickBooks' recent fees ÷ income, applied to the order.
 *  - Production labour, advertising and overheads are period costs: Planday,
 *    the Meta + Google spend, and QuickBooks' recent overheads. On an order
 *    they're shared out — labour per pack, ads and overheads per order.
 *  - Gross profit = income − food − packaging − courier − fees − labour,
 *    the same as QuickBooks'. Advertising comes after it, then overheads.
 */
import { isCollectionOrder, isLocalDeliveryOrder } from "../dispatch-tag";
import type { PnlLine } from "./qbo-pnl-by-month";

// ── Buckets ─────────────────────────────────────────────────────────────

export const BUCKETS = [
  "income", "food", "packaging", "courier", "payment_fees", "production_labour",
  "other_cost_of_sales", "advertising", "overhead", "below_line", "ignore",
] as const;
export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_LABELS: Record<Bucket, string> = {
  income: "Income",
  food: "Food",
  packaging: "Packaging",
  courier: "Courier",
  payment_fees: "Payment fees",
  production_labour: "Production labour",
  other_cost_of_sales: "Other cost of sales",
  advertising: "Advertising",
  overhead: "Overheads",
  below_line: "Depreciation, interest & other",
  ignore: "Leave out",
};

export const COST_OF_SALES: readonly Bucket[] = ["food", "packaging", "courier", "payment_fees", "production_labour", "other_cost_of_sales"];

export function isBucket(s: string): s is Bucket {
  return (BUCKETS as readonly string[]).includes(s);
}

/** How an account name is matched: lower case, single spaces. */
export function accountKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const INCOME_GROUPS = new Set(["Income", "OtherIncome"]);

/** Where an account with no bucket of its own (or its parent's) lands. */
export function defaultBucket(group: string | null): Bucket {
  switch (group) {
    case "Income": return "income";
    case "COGS": return "other_cost_of_sales";
    case "Expenses": return "overhead";
    case "OtherIncome":
    case "OtherExpenses": return "below_line";
    default: return "ignore";
  }
}

export interface AccountBucket {
  key: string;        // the line's path key in the report
  name: string;
  accountKey: string;
  depth: number;
  group: string | null;
  bucket: Bucket;
  /** "set" = chosen for this account; "inherited" = from a parent account;
   *  "default" = from its P&L group — worth checking. */
  source: "set" | "inherited" | "default";
  amounts: number[];
  total: number;
  isLeaf: boolean;
}

/**
 * Give every account line in the report its bucket. Computed totals (Gross
 * Profit, Net Income…) are skipped; only accounts carry money into buckets.
 */
export function resolveBuckets(lines: readonly PnlLine[], chosen: ReadonlyMap<string, Bucket>): AccountBucket[] {
  const out: AccountBucket[] = [];
  const walk = (ls: readonly PnlLine[], inherited: Bucket | null) => {
    for (const l of ls) {
      if (l.kind === "total") continue;
      const isTopGroup = l.depth === 0;
      const own = isTopGroup ? undefined : chosen.get(accountKey(l.name));
      const bucket: Bucket = own ?? inherited ?? defaultBucket(l.group);
      const source: AccountBucket["source"] = own ? "set" : inherited ? "inherited" : "default";
      if (!isTopGroup) {
        out.push({
          key: l.key, name: l.name, accountKey: accountKey(l.name), depth: l.depth, group: l.group,
          bucket, source, amounts: l.amounts, total: l.total, isLeaf: l.children.length === 0,
        });
      }
      // A parent's own postings are a child with the parent's name: it takes
      // the parent's bucket, which is what `own ?? inherited` gives it.
      walk(l.children, isTopGroup ? null : (own ?? inherited));
    }
  };
  walk(lines, null);
  return out;
}

/**
 * Money per bucket per month. Income buckets are positive income; cost
 * buckets positive cost. An income-side account in a cost bucket (or the
 * reverse) counts against it, so "Other income" reduces below-the-line cost.
 */
export function bucketTotals(accounts: readonly AccountBucket[], monthCount: number): Record<Bucket, number[]> {
  const out = Object.fromEntries(BUCKETS.map(b => [b, Array.from({ length: monthCount }, () => 0)])) as Record<Bucket, number[]>;
  for (const a of accounts) {
    if (!a.isLeaf) continue;
    const incomeSide = INCOME_GROUPS.has(a.group ?? "");
    const sign = (a.bucket === "income") === incomeSide ? 1 : -1;
    for (let i = 0; i < monthCount; i++) out[a.bucket][i]! += sign * (a.amounts[i] ?? 0);
  }
  for (const b of BUCKETS) out[b] = out[b].map(round2);
  return out;
}

// ── Calibration from QuickBooks ─────────────────────────────────────────

export interface Calibration {
  months: string[];             // the complete months averaged, YYYY-MM
  overheadMonthly: number;
  belowLineMonthly: number;
  otherCostOfSalesMonthly: number;
  paymentFeeRate: number;       // fees ÷ income
  labourRate: number;           // production labour ÷ income — fallback only
}

const avg = (xs: readonly number[]) => (xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : 0);
const sum = (xs: readonly number[]) => xs.reduce((s, n) => s + n, 0);

export function calibrate(totals: Record<Bucket, number[]>, months: string[]): Calibration {
  const income = sum(totals.income);
  return {
    months,
    overheadMonthly: round2(avg(totals.overhead)),
    belowLineMonthly: round2(avg(totals.below_line)),
    otherCostOfSalesMonthly: round2(avg(totals.other_cost_of_sales)),
    paymentFeeRate: income > 0 ? sum(totals.payment_fees) / income : 0,
    labourRate: income > 0 ? sum(totals.production_labour) / income : 0,
  };
}

// ── Orders ──────────────────────────────────────────────────────────────

export interface TrackerLine {
  variantId: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  price: number;    // per unit
  discount: number; // this line's share of discounts
  /** Shopify's flags: false / true for a digital product (membership, gift card). */
  requiresShipping?: boolean | null;
  giftCard?: boolean | null;
}

/**
 * Digital products (Graeme, 25 Nov 2026: "if there are only digital
 * products on there … there are no packaging and fulfilment costs either.
 * It should just be pretty much 100% margin"). A line Shopify says doesn't
 * need shipping, or a gift card, costs nothing to make or pack and isn't
 * flagged as uncosted; an order of nothing else needs no box or courier —
 * even when a subscription tag says "Small Box". Payment fees still apply.
 */
export function isDigitalLine(l: { requiresShipping?: boolean | null; giftCard?: boolean | null }): boolean {
  return l.requiresShipping === false || l.giftCard === true;
}

/**
 * One unit of a supply sold through Shopify (Graeme, 25 Nov 2026: the order
 * insert — a packaging supply mapped to its Shopify product, "1.6p per
 * piece"): its pack cost ÷ the Shopify units in a pack. Null when the
 * supply has no cost. Packaging-category supplies count as packaging, the
 * rest (bought-in brownies, sauces) as food. Pure.
 */
export function supplyUnitCosting(s: { name: string; costPerPack: number | null; unitsPerPack: number | null; category: string | null }): VariantCosting | null {
  const cost = Number(s.costPerPack);
  if (!(cost > 0)) return null;
  const per = cost / (Number(s.unitsPerPack) > 0 ? Number(s.unitsPerPack) : 1);
  const packaging = (s.category ?? "").toLowerCase() === "packaging";
  return { name: s.name, food: packaging ? 0 : per, packaging: packaging ? per : 0, isPack: false };
}

/** Every line with a quantity is digital (and there is at least one). */
export function isDigitalOnlyOrder(lines: ReadonlyArray<{ quantity: number; requiresShipping?: boolean | null; giftCard?: boolean | null }>): boolean {
  const real = lines.filter(l => (Number(l.quantity) || 0) > 0);
  return real.length > 0 && real.every(isDigitalLine);
}

export interface TrackerOrder {
  id: number;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  tags: string | null;
  totalPrice: number;
  subtotalPrice: number;
  totalTax: number;
  totalDiscounts: number;
  totalWeight: number;
  refunded: number;
  lines: TrackerLine[];
}

export interface VariantCosting {
  /** What the product is called in the summaries (recipe name when costed from a recipe). */
  name: string;
  food: number;      // per unit sold
  packaging: number; // per unit sold (the recipe's own packaging)
  /** Counts as a pack (a recipe item) rather than an extra like mayo. */
  isPack: boolean;
}

export interface CostRates {
  smallBox: number;
  largeBox: number;
  smallCourier: number;
  largeCourier: number;
  weightThresholdGrams: number;
  paymentFeeRate: number;
}

export type BoxSize = "small" | "large" | "none";

/**
 * Small or large box — the packing bench's rule: a "Large Box" or
 * "wholesale" tag, else a "Small Box" tag, else by weight. Weightless orders
 * with no box tag (gift cards, memberships) ship nothing.
 */
export function boxSizeFor(tags: string | null | undefined, weightGrams: number, thresholdGrams: number): BoxSize {
  const t = (tags ?? "").split(",").map(x => x.trim().toLowerCase());
  const large = t.includes("large box") || t.includes("wholesale");
  const small = t.includes("small box");
  if (!weightGrams && !large && !small) return "none";
  return large || (!small && weightGrams >= thresholdGrams) ? "large" : "small";
}

export interface OrderEconomics {
  id: number;
  name: string;
  createdAt: string;
  day: string; // London day placed
  tags: string | null;
  box: BoxSize;
  usesCourier: boolean;
  packs: number;
  items: number;
  /** What's in it; `costed` false = no recipe and no Shopify cost, so its cost is missing.
   *  `variantId` / `title` are the Shopify variant and its line title, so an
   *  uncosted item can be given a cost from the order pop-up (25 Nov 2026).
   *  Costed lines are grouped by name, so a recipe's main and wonky share a
   *  row (variantId is then the first one seen); uncosted lines are one row
   *  per Shopify variant. */
  products: OrderProduct[];
  revenue: number;          // ex VAT, after discounts and refunds, incl. shipping charged
  shippingCharged: number;
  discounts: number;
  refunded: number;
  food: number;
  packaging: number;        // recipe packaging + box
  /** Food + the recipe's own packaging (tray, film, label) — what the products cost as costed in the app. */
  productCost: number;
  /** The outer box, insulation and ice. packaging = productCost's packaging + this. */
  boxCost: number;
  courier: number;
  paymentFees: number;
  /** Before labour: revenue − food − packaging − courier − fees. */
  orderProfit: number;
  /** Items with no costing — their food cost is missing, so profit is overstated. */
  uncostedItems: number;
}

export interface OrderProduct {
  name: string;
  quantity: number;
  costed: boolean;
  variantId: string | null;
  /** The Shopify line's own title (with the variant's, when it has one). */
  title: string;
}

/** "Product – 2 Pack"; Shopify's "Default Title" adds nothing. */
export function lineDisplayTitle(title: string | null | undefined, variantTitle: string | null | undefined): string {
  const t = (title ?? "").trim() || "Unknown item";
  const v = (variantTitle ?? "").trim();
  return v && v.toLowerCase() !== "default title" ? `${t} – ${v}` : t;
}

export function costOrder(o: TrackerOrder, costing: ReadonlyMap<string, VariantCosting>, rates: CostRates, londonDay: (iso: string) => string): OrderEconomics {
  const revenue = o.totalPrice - o.totalTax - o.refunded;
  const shippingCharged = Math.max(0, o.totalPrice - o.subtotalPrice);
  let food = 0, recipePackaging = 0, packs = 0, items = 0, uncosted = 0;
  const products = new Map<string, OrderProduct>();
  const addProduct = (key: string, name: string, q: number, costed: boolean, variantId: string | null, title: string) => {
    const was = products.get(key);
    products.set(key, {
      name, quantity: (was?.quantity ?? 0) + q, costed: (was?.costed ?? true) && costed,
      variantId: was ? was.variantId : variantId, title: was ? was.title : title,
    });
  };
  for (const li of o.lines) {
    const q = Number(li.quantity) || 0;
    if (q <= 0) continue;
    items += q;
    const vid = li.variantId ?? null;
    const title = lineDisplayTitle(li.title, li.variantTitle);
    if (isDigitalLine(li)) { const n = li.title || "Digital item"; addProduct(`n:${n}`, n, q, true, vid, title); continue; }
    const c = vid ? costing.get(vid) : undefined;
    if (!c) {
      uncosted += q;
      // One row per Shopify variant, so each can be given its own cost.
      addProduct(vid ? `v:${vid}` : `n:${title}`, title, q, false, vid, title);
      continue;
    }
    food += c.food * q;
    recipePackaging += c.packaging * q;
    if (c.isPack) packs += q;
    addProduct(`n:${c.name}`, c.name, q, true, vid, title);
  }
  const box = isDigitalOnlyOrder(o.lines) ? "none" : boxSizeFor(o.tags, o.totalWeight, rates.weightThresholdGrams);
  const collected = isCollectionOrder(o.tags);
  const usesCourier = box !== "none" && !collected && !isLocalDeliveryOrder(o.tags);
  const boxCost = box === "none" || collected ? 0 : box === "large" ? rates.largeBox : rates.smallBox;
  const courier = usesCourier ? (box === "large" ? rates.largeCourier : rates.smallCourier) : 0;
  const packaging = recipePackaging + boxCost;
  const paymentFees = o.totalPrice * rates.paymentFeeRate;
  return {
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    day: londonDay(o.createdAt),
    tags: o.tags,
    box,
    usesCourier,
    packs,
    items,
    products: [...products.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)),
    revenue: round2(revenue),
    shippingCharged: round2(shippingCharged),
    discounts: round2(o.totalDiscounts),
    refunded: round2(o.refunded),
    food: round2(food),
    packaging: round2(packaging),
    productCost: round2(food + recipePackaging),
    boxCost: round2(boxCost),
    courier: round2(courier),
    paymentFees: round2(paymentFees),
    orderProfit: round2(revenue - food - packaging - courier - paymentFees),
    uncostedItems: uncosted,
  };
}

// ── The period P&L ──────────────────────────────────────────────────────

export interface PeriodCosts {
  days: number;
  /** Planday wages + employer costs for the period; null when Planday couldn't be read. */
  labour: number | null;
  advertising: number;
  calibration: Calibration;
}

export interface PnlLineOut {
  key: Bucket | "gross_profit" | "after_advertising" | "operating_profit" | "net_profit";
  label: string;
  amount: number;
  /** One plain sentence: where the figure comes from. */
  how: string;
}

export interface PeriodPnl {
  orders: number;
  packs: number;
  lines: PnlLineOut[];
  income: number;
  grossProfit: number;
  netProfit: number;
  labourPerPack: number;
  adsPerOrder: number;
  overheadPerOrder: number;
  labourSource: "planday" | "estimate";
  uncostedItems: number;
}

const perDay = (monthly: number, days: number) => (monthly * 12 / 365) * days;

export function periodPnl(orders: readonly OrderEconomics[], costs: PeriodCosts): PeriodPnl {
  const s = (f: (o: OrderEconomics) => number) => round2(orders.reduce((t, o) => t + f(o), 0));
  const income = s(o => o.revenue);
  const food = s(o => o.food);
  const packaging = s(o => o.packaging);
  const courier = s(o => o.courier);
  const fees = s(o => o.paymentFees);
  const packs = orders.reduce((t, o) => t + o.packs, 0);
  const labourSource = costs.labour != null ? "planday" : "estimate";
  const labour = round2(costs.labour ?? income * costs.calibration.labourRate);
  const otherCos = round2(perDay(costs.calibration.otherCostOfSalesMonthly, costs.days));
  const grossProfit = round2(income - food - packaging - courier - fees - labour - otherCos);
  const advertising = round2(costs.advertising);
  const afterAds = round2(grossProfit - advertising);
  const overhead = round2(perDay(costs.calibration.overheadMonthly, costs.days));
  const operating = round2(afterAds - overhead);
  const belowLine = round2(perDay(costs.calibration.belowLineMonthly, costs.days));
  const net = round2(operating - belowLine);
  const avgMonths = costs.calibration.months.length;
  const lines: PnlLineOut[] = [
    { key: "income", label: "Income", amount: income, how: "Orders placed in the period: order total less VAT and refunds, shipping charged included." },
    { key: "food", label: "Food", amount: food, how: "Each item's recipe ingredient cost (or Shopify's cost for bought-in items)." },
    { key: "packaging", label: "Packaging", amount: packaging, how: "Each recipe's tray, film and label, plus the box, insulation and ice per order." },
    { key: "courier", label: "Courier", amount: courier, how: "APC's flat price per parcel by box size. Collections and van deliveries have none." },
    { key: "payment_fees", label: "Payment fees", amount: fees, how: `${(costs.calibration.paymentFeeRate * 100).toFixed(2)}% of each order — QuickBooks' fees ÷ income over the last ${avgMonths} months.` },
    { key: "production_labour", label: "Production labour", amount: labour, how: labourSource === "planday" ? "Planday wages for the period, with employer NI and pension." : `Planday couldn't be read, so ${(costs.calibration.labourRate * 100).toFixed(1)}% of income, as in QuickBooks lately.` },
    ...(otherCos !== 0 ? [{ key: "other_cost_of_sales" as const, label: "Other cost of sales", amount: otherCos, how: `QuickBooks' average over the last ${avgMonths} months, per day.` }] : []),
    { key: "gross_profit", label: "Gross profit", amount: grossProfit, how: "Income less everything above — the same line as QuickBooks." },
    { key: "advertising", label: "Advertising", amount: advertising, how: "Meta and Google spend on these days." },
    { key: "after_advertising", label: "Profit after advertising", amount: afterAds, how: "Gross profit less advertising." },
    { key: "overhead", label: "Overheads", amount: overhead, how: `QuickBooks' overheads, averaged over the last ${avgMonths} complete months, per day.` },
    { key: "operating_profit", label: "Operating profit", amount: operating, how: "QuickBooks calls this Net Operating Income." },
    { key: "below_line", label: "Depreciation, interest & other", amount: belowLine, how: `QuickBooks' average over the last ${avgMonths} months, per day.` },
    { key: "net_profit", label: "Net profit", amount: net, how: "What's left — QuickBooks' Net Income." },
  ];
  return {
    orders: orders.length,
    packs,
    lines,
    income,
    grossProfit,
    netProfit: net,
    labourPerPack: packs > 0 ? round2(labour / packs) : 0,
    adsPerOrder: orders.length > 0 ? round2(advertising / orders.length) : 0,
    overheadPerOrder: orders.length > 0 ? round2((overhead + belowLine) / orders.length) : 0,
    labourSource,
    uncostedItems: orders.reduce((t, o) => t + o.uncostedItems, 0),
  };
}

// ── Per-order rows with shared costs ────────────────────────────────────

export interface OrderRow extends OrderEconomics {
  labour: number;
  grossProfit: number;   // after labour — QuickBooks' gross profit for this order
  advertising: number;
  overhead: number;
  netProfit: number;
  margin: number | null; // net profit ÷ revenue
  /** Gross profit ÷ revenue — the order's contribution before the shared ads
   *  and overheads (Graeme, 24 Nov 2026: what the order table shows). */
  grossMargin: number | null;
  /** Contribution (orderProfit: revenue less product cost, box, courier and
   *  fees — before labour) ÷ revenue. What the order table shows since
   *  Graeme took labour out (24 Nov 2026). */
  contributionMargin: number | null;
}

export function orderRows(orders: readonly OrderEconomics[], p: Pick<PeriodPnl, "labourPerPack" | "adsPerOrder" | "overheadPerOrder">): OrderRow[] {
  return orders.map(o => {
    const labour = round2(o.packs * p.labourPerPack);
    const grossProfit = round2(o.orderProfit - labour);
    const netProfit = round2(grossProfit - p.adsPerOrder - p.overheadPerOrder);
    return {
      ...o,
      labour,
      grossProfit,
      advertising: p.adsPerOrder,
      overhead: p.overheadPerOrder,
      netProfit,
      margin: o.revenue > 0 ? round2((netProfit / o.revenue) * 100) : null,
      grossMargin: o.revenue > 0 ? round2((grossProfit / o.revenue) * 100) : null,
      contributionMargin: o.revenue > 0 ? round2((o.orderProfit / o.revenue) * 100) : null,
    };
  });
}

// ── Which orders and products pay ───────────────────────────────────────

export interface GroupSummary {
  label: string;
  orders: number;
  revenue: number;      // average per order
  grossProfit: number;  // average per order
  netProfit: number;    // average per order
  margin: number | null; // total net ÷ total revenue
  shareOfProfit: number | null; // this group's net profit ÷ all net profit
}

function summarise(label: string, rows: readonly OrderRow[], allNet: number): GroupSummary {
  const n = rows.length;
  const rev = rows.reduce((t, r) => t + r.revenue, 0);
  const gp = rows.reduce((t, r) => t + r.grossProfit, 0);
  const net = rows.reduce((t, r) => t + r.netProfit, 0);
  return {
    label,
    orders: n,
    revenue: n ? round2(rev / n) : 0,
    grossProfit: n ? round2(gp / n) : 0,
    netProfit: n ? round2(net / n) : 0,
    margin: rev > 0 ? round2((net / rev) * 100) : null,
    shareOfProfit: allNet !== 0 ? round2((net / allNet) * 100) : null,
  };
}

/** Orders grouped by how many packs they hold (with the extras ignored). */
export function bySize(rows: readonly OrderRow[]): GroupSummary[] {
  const allNet = rows.reduce((t, r) => t + r.netProfit, 0);
  const groups = new Map<number, OrderRow[]>();
  for (const r of rows) {
    if (r.box === "none") continue;
    const k = Math.min(r.packs, 10);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, rs]) => summarise(k === 10 ? "10+ packs" : `${k} pack${k === 1 ? "" : "s"}`, rs, allNet));
}

export interface ProductSummary {
  name: string;
  quantity: number;
  ordersWithIt: number;
  /** Average net profit of the orders it's in, and their margin — does it
   *  ride along with good orders or poor ones? */
  avgOrderNetProfit: number;
  orderMargin: number | null;
  /** Its own takings per unit (line price less its discount) less food and
   *  its own packaging — what it adds before the order's shared costs. */
  unitContribution: number | null;
}

export function byProduct(rows: readonly OrderRow[], orders: readonly TrackerOrder[], costing: ReadonlyMap<string, VariantCosting>): ProductSummary[] {
  const rowById = new Map(rows.map(r => [r.id, r]));
  const acc = new Map<string, { q: number; ids: Set<number>; takings: number; costs: number; costed: boolean }>();
  for (const o of orders) {
    if (!rowById.has(o.id)) continue;
    for (const li of o.lines) {
      const q = Number(li.quantity) || 0;
      if (q <= 0) continue;
      const c = li.variantId ? costing.get(li.variantId) : undefined;
      const name = c?.name ?? (li.title || "Unknown item");
      const a = acc.get(name) ?? { q: 0, ids: new Set<number>(), takings: 0, costs: 0, costed: true };
      a.q += q;
      a.ids.add(o.id);
      a.takings += li.price * q - li.discount;
      if (c) a.costs += (c.food + c.packaging) * q; else if (!isDigitalLine(li)) a.costed = false;
      acc.set(name, a);
    }
  }
  return [...acc.entries()].map(([name, a]) => {
    const rs = [...a.ids].map(id => rowById.get(id)!);
    const rev = rs.reduce((t, r) => t + r.revenue, 0);
    const net = rs.reduce((t, r) => t + r.netProfit, 0);
    return {
      name,
      quantity: a.q,
      ordersWithIt: rs.length,
      avgOrderNetProfit: rs.length ? round2(net / rs.length) : 0,
      orderMargin: rev > 0 ? round2((net / rev) * 100) : null,
      unitContribution: a.costed && a.q > 0 ? round2((a.takings - a.costs) / a.q) : null,
    };
  }).sort((a, b) => b.quantity - a.quantity);
}

// ── Predicted vs QuickBooks ─────────────────────────────────────────────

export interface CompareRow {
  key: string;
  label: string;
  predicted: number;
  actual: number;
  gap: number; // actual − predicted
}

/** The predicted month beside QuickBooks' month, line by line. */
export function compareMonth(p: PeriodPnl, actual: Record<Bucket, number>): CompareRow[] {
  const get = (k: PnlLineOut["key"]) => p.lines.find(l => l.key === k)?.amount ?? 0;
  const cos = COST_OF_SALES.reduce((t, b) => t + (actual[b] ?? 0), 0);
  const gpActual = actual.income - cos;
  const opActual = gpActual - actual.advertising - actual.overhead;
  const rows: Array<[CompareRow["key"], string, number, number]> = [
    ["income", "Income", get("income"), actual.income],
    ["food", "Food", get("food"), actual.food],
    ["packaging", "Packaging", get("packaging"), actual.packaging],
    ["courier", "Courier", get("courier"), actual.courier],
    ["payment_fees", "Payment fees", get("payment_fees"), actual.payment_fees],
    ["production_labour", "Production labour", get("production_labour"), actual.production_labour],
    ["other_cost_of_sales", "Other cost of sales", get("other_cost_of_sales"), actual.other_cost_of_sales],
    ["gross_profit", "Gross profit", get("gross_profit"), gpActual],
    ["advertising", "Advertising", get("advertising"), actual.advertising],
    ["overhead", "Overheads", get("overhead"), actual.overhead],
    ["operating_profit", "Operating profit", get("operating_profit"), opActual],
  ];
  return rows.map(([key, label, predicted, act]) => ({ key, label, predicted: round2(predicted), actual: round2(act), gap: round2(act - predicted) }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
