/**
 * Orders sold vs dispatched — balancing the P&L each month (Objective I,
 * finance & reporting; pure).
 *
 * Shopify books an order when it's PLACED, but we earn it when it goes
 * out. Pre-orders and late-month orders make the two differ, so the P&L
 * needs both counts side by side for each month:
 *
 *   SOLD        created_at falls in the period (Europe/London day).
 *   DISPATCHED  the day the order left falls in the period. That day comes
 *               from the delivery-date tag (YYYY-MM-DD): delivery − 1, or
 *               the Friday before (delivery − 3) for a Monday delivery,
 *               because nothing goes out at the weekend.
 *
 * Cancelled orders (cancelled_at set) count on neither side. Orders with
 * no date tag can't be placed on a dispatch day, so they're counted on
 * their own (by sold month) rather than silently disappearing.
 *
 * Rules checked against live data on 18 Nov 2026 (Jun–Oct 2026).
 */
import { deliveryDateTag } from "./team-efficiency-despatch";
import { addDaysToDateString, londonDateString } from "./london-time";

/** The few fields of a mirrored Shopify order this report reads. */
export interface SvdOrder {
  createdAt: string;           // ISO instant
  cancelledAt: string | null;
  tags: string | null;
  totalPrice: string | null;   // Shopify's decimal string
}

/**
 * The £ an order is worth in this report: total_price — incl. VAT and
 * delivery, before refunds. The ONE place money is worked out, so an
 * ex-VAT or refund-adjusted version is a change here only.
 */
export function orderValue(o: Pick<SvdOrder, "totalPrice">): number {
  const n = parseFloat(o.totalPrice ?? "0");
  return Number.isFinite(n) ? n : 0;
}

/** What the £ columns mean — shown on the card next to the figures. */
export const VALUE_BASIS = "incl. VAT & delivery, before refunds";

/** The day an order with this delivery date was dispatched. */
export function dispatchDayForDelivery(delivery: string): string {
  const dow = new Date(`${delivery}T00:00:00Z`).getUTCDay(); // 0 Sun … 1 Mon
  return addDaysToDateString(delivery, dow === 1 ? -3 : -1);
}

/** The order's dispatch day from its tags, or null when it has no date tag. */
export function dispatchDayOf(tags: string | null | undefined): string | null {
  const delivery = deliveryDateTag(tags);
  return delivery ? dispatchDayForDelivery(delivery) : null;
}

// ── Periods ──────────────────────────────────────────────────────────────

export interface Period {
  key: string;     // "2026-10" for a month, "from..to" for a custom range
  from: string;    // YYYY-MM-DD, inclusive
  to: string;      // YYYY-MM-DD, inclusive
  label: string;   // "Oct 2026" / "3 Oct – 18 Nov 2026"
  partial: boolean; // still running (ends after today)
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}

function shortDate(d: string, withYear: boolean): string {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m! - 1]}${withYear ? ` ${y}` : ""}`;
}

/** One period per whole month from fromMonth to toMonth (YYYY-MM). */
export function monthPeriods(fromMonth: string, toMonth: string, today: string): Period[] {
  const out: Period[] = [];
  let [y, m] = fromMonth.split("-").map(Number) as [number, number];
  for (let guard = 0; guard < 240; guard++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym > toMonth) break;
    const to = lastDayOfMonth(ym);
    out.push({ key: ym, from: `${ym}-01`, to, label: `${MONTHS[m - 1]} ${y}`, partial: to > today });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** A custom date range: one row, the same daily rules grouped over it. */
export function rangePeriod(from: string, to: string, today: string): Period {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return {
    key: `${from}..${to}`,
    from,
    to,
    label: `${shortDate(from, !sameYear)} – ${shortDate(to, true)}`,
    partial: to > today,
  };
}

/** The default view: the last 3 complete months plus this month so far. */
export function defaultMonths(today: string): { fromMonth: string; toMonth: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const back = new Date(Date.UTC(y, m - 1 - 3, 1));
  return { fromMonth: back.toISOString().slice(0, 7), toMonth: today.slice(0, 7) };
}

/** How far before a period dispatched orders may have been placed (pre-orders). */
export const PREORDER_LOOKBACK_DAYS = 42;

/** The created_at window to read so both sides of `periods` are complete. */
export function ordersWindow(periods: readonly Period[]): { from: string; to: string } {
  const from = periods.reduce((a, p) => (p.from < a ? p.from : a), periods[0]!.from);
  const to = periods.reduce((a, p) => (p.to > a ? p.to : a), periods[0]!.to);
  return { from: addDaysToDateString(from, -PREORDER_LOOKBACK_DAYS), to };
}

// ── The report ───────────────────────────────────────────────────────────

export interface SvdRow {
  key: string;
  label: string;
  from: string;
  to: string;
  partial: boolean;
  sold: number;
  dispatched: number;
  difference: number;      // sold − dispatched
  soldValue: number;
  dispatchedValue: number;
  valueDifference: number; // soldValue − dispatchedValue
  noDeliveryDate: number;  // sold in the period but carrying no date tag
  apcScanned: number | null; // null = no APC data for (all of) the period
}

export interface SvdReport {
  rows: SvdRow[];
  totals: Omit<SvdRow, "key" | "label" | "from" | "to" | "partial">;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function periodOf(day: string, periods: readonly Period[]): Period | undefined {
  return periods.find(p => day >= p.from && day <= p.to);
}

/**
 * Count each period's sold and dispatched orders.
 *
 * `apcScanned` per period key is the distinct orders scanned onto APC in
 * the period; a period starting before `apcFrom` shows null (a dash), since
 * a part-month count would look like a shortfall.
 *
 * `asOf` (today) stops a running month counting pre-orders that haven't
 * gone out yet: a dispatch day after it isn't dispatched.
 */
export function soldVsDispatched(
  orders: readonly SvdOrder[],
  periods: readonly Period[],
  apc: { scannedByPeriod: ReadonlyMap<string, number>; apcFrom: string | null } = { scannedByPeriod: new Map(), apcFrom: null },
  asOf: string | null = null,
): SvdReport {
  const acc = new Map(periods.map(p => [p.key, { sold: 0, dispatched: 0, soldValue: 0, dispatchedValue: 0, noDeliveryDate: 0 }]));

  for (const o of orders) {
    if (o.cancelledAt) continue;
    const value = orderValue(o);
    const created = new Date(o.createdAt);
    const soldIn = Number.isNaN(created.getTime()) ? undefined : periodOf(londonDateString(created), periods);
    if (soldIn) {
      const a = acc.get(soldIn.key)!;
      a.sold += 1;
      a.soldValue += value;
    }
    const day = dispatchDayOf(o.tags);
    if (day == null) {
      if (soldIn) acc.get(soldIn.key)!.noDeliveryDate += 1;
      continue;
    }
    if (asOf != null && day > asOf) continue;
    const sentIn = periodOf(day, periods);
    if (sentIn) {
      const a = acc.get(sentIn.key)!;
      a.dispatched += 1;
      a.dispatchedValue += value;
    }
  }

  const rows: SvdRow[] = periods.map(p => {
    const a = acc.get(p.key)!;
    const hasApc = apc.apcFrom != null && p.from >= apc.apcFrom;
    return {
      key: p.key,
      label: p.label,
      from: p.from,
      to: p.to,
      partial: p.partial,
      sold: a.sold,
      dispatched: a.dispatched,
      difference: a.sold - a.dispatched,
      soldValue: round2(a.soldValue),
      dispatchedValue: round2(a.dispatchedValue),
      valueDifference: round2(a.soldValue - a.dispatchedValue),
      noDeliveryDate: a.noDeliveryDate,
      apcScanned: hasApc ? (apc.scannedByPeriod.get(p.key) ?? 0) : null,
    };
  });

  const sum = (f: (r: SvdRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const apcRows = rows.filter(r => r.apcScanned != null);
  return {
    rows,
    totals: {
      sold: sum(r => r.sold),
      dispatched: sum(r => r.dispatched),
      difference: sum(r => r.difference),
      soldValue: round2(sum(r => r.soldValue)),
      dispatchedValue: round2(sum(r => r.dispatchedValue)),
      valueDifference: round2(sum(r => r.valueDifference)),
      noDeliveryDate: sum(r => r.noDeliveryDate),
      // Only a total when every row has APC figures — a sum that skips
      // months would read as a shortfall.
      apcScanned: rows.length > 0 && apcRows.length === rows.length ? sum(r => r.apcScanned ?? 0) : null,
    },
  };
}

/** Which period an APC scan day belongs to (for bucketing the query rows). */
export function periodKeyForDay(day: string, periods: readonly Period[]): string | null {
  return periodOf(day, periods)?.key ?? null;
}
