/**
 * Trend graphs on the founder Numbers page — what each graph shows, and how
 * a server series becomes chart points (Objective I).
 *
 * The server (GET /api/founder-numbers/trend, api-server/src/lib/sales-trend.ts)
 * does all the counting and the reconciliation maths; this file only picks
 * a metric out of each bucket, lines today up against last week, and
 * decides what headline to print. The headline is ALWAYS the period figure
 * the server computed from the whole period (totals), so it matches the
 * tile above it — never a sum or mean re-derived from the drawn points.
 */

export type Granularity = "hour" | "day" | "week" | "month";

/** The per-bucket and whole-period figures (mirrors the server's TrendFigures). */
export interface TrendFigures {
  revenue: number;
  orders: number;
  /** Orders with revenue above £0 — AOV's divisor (£0 resends left out). */
  paidOrders: number;
  aov: number | null;
  newCustomerRevenue: number;
  newCustomerOrders: number;
  recurringSubOrders: number;
  newSubOrders: number;
  subscriptionRevenue: number;
  subscriptionOrders: number;
  adSpend: number | null;
  spendDaysRecorded: number;
  spendDays: number;
  roasPercent: number | null;
}

export interface TrendBucket extends TrendFigures {
  key: string;
  start: string;
  end: string;
  label: string;
  longLabel: string;
  hourOfDay: number | null;
  dayCount: number;
  future: boolean;
  /** Still running at "now". */
  running: boolean;
  /** Running, or a week/month the period only partly covers. */
  partial: boolean;
}

export interface TrendSeries {
  from: string;
  to: string;
  granularity: Granularity;
  allowed: Granularity[];
  buckets: TrendBucket[];
  totals: TrendFigures;
  outsideOrders: number;
}

export type TrendMetricId =
  | "revenue"
  | "orders"
  | "aov"
  | "newCustomerOrders"
  | "newCustomerRevenue"
  | "roas"
  | "adSpend"
  | "recurringSubOrders"
  | "newSubOrders"
  | "subscriptionRevenue";

export type MetricFormat = "money" | "count" | "percent";

export interface TrendMetric {
  id: TrendMetricId;
  /** Graph heading, e.g. "Total sales". */
  label: string;
  format: MetricFormat;
  /** Sums over time (sales, orders) or is a ratio (AOV, ROAS)? Ratios get a
   *  dashed line at the period figure instead of a running total. */
  kind: "total" | "ratio";
  /** Ad spend is recorded per day, so these can't be split by the hour. */
  daily: boolean;
  /** An average over baskets: a gap means "no paid orders", so a faint
   *  dashed bridge may span a single missing bucket, and buckets resting on
   *  one or two baskets are drawn lighter. (Not for spend-based gaps, which
   *  mean "we don't know".) */
  perBasket?: boolean;
  value: (f: TrendFigures) => number | null;
}

export const TREND_METRICS: Record<TrendMetricId, TrendMetric> = {
  revenue: { id: "revenue", label: "Total sales", format: "money", kind: "total", daily: false, value: f => f.revenue },
  orders: { id: "orders", label: "Orders", format: "count", kind: "total", daily: false, value: f => f.orders },
  aov: { id: "aov", label: "Average order value", format: "money", kind: "ratio", daily: false, perBasket: true, value: f => f.aov },
  newCustomerOrders: { id: "newCustomerOrders", label: "New customers", format: "count", kind: "total", daily: false, value: f => f.newCustomerOrders },
  newCustomerRevenue: { id: "newCustomerRevenue", label: "New customer revenue", format: "money", kind: "total", daily: false, value: f => f.newCustomerRevenue },
  roas: { id: "roas", label: "New customer ROAS", format: "percent", kind: "ratio", daily: true, value: f => f.roasPercent },
  adSpend: { id: "adSpend", label: "Ad spend", format: "money", kind: "total", daily: true, value: f => f.adSpend },
  recurringSubOrders: { id: "recurringSubOrders", label: "Recurring subscriptions", format: "count", kind: "total", daily: false, value: f => f.recurringSubOrders },
  newSubOrders: { id: "newSubOrders", label: "New subscriptions", format: "count", kind: "total", daily: false, value: f => f.newSubOrders },
  subscriptionRevenue: { id: "subscriptionRevenue", label: "Total subscription revenue", format: "money", kind: "total", daily: false, value: f => f.subscriptionRevenue },
};

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GBP_WHOLE = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

/** A metric value for a headline or tooltip; "—" for "we don't know". */
export function formatMetric(format: MetricFormat, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (format === "money") return GBP.format(v);
  if (format === "percent") return `${Math.round(v)}%`;
  return Math.round(v).toLocaleString("en-GB");
}

/** A compact axis tick: "£1.2k", "£350", "12", "250%". */
export function formatAxis(format: MetricFormat, v: number): string {
  if (format === "percent") return `${Math.round(v)}%`;
  if (format === "count") return Number.isInteger(v) ? String(v) : "";
  if (Math.abs(v) >= 1000) return `£${(v / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 })}k`;
  return GBP_WHOLE.format(v);
}

export function granularityLabel(g: Granularity): string {
  return g === "hour" ? "By the hour" : g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly";
}

/**
 * The note under a weekly or monthly graph when its first or last bucket is
 * only partly inside the period — so a short week or half month isn't read
 * as a bad one. null when there's nothing to say.
 */
export function partialBucketNote(series: TrendSeries): string | null {
  if (series.granularity !== "week" && series.granularity !== "month") return null;
  const short = series.buckets.filter(b => b.partial && !b.future);
  if (short.length === 0) return null;
  const unit = series.granularity === "week" ? "week" : "month";
  const running = short.some(b => b.running);
  return `${short.length === 1 ? `One ${unit} is` : `The first and last ${unit}s are`} only partly inside this period${running ? " (or still running)" : ""}` +
    `${unit === "month" ? ", marked \"(part)\"" : ""} — hover to see how many days ${short.length === 1 ? "it covers" : "each covers"}.`;
}

/** A per-basket bucket resting on this many paid orders or fewer is drawn lighter. */
export const FEW_ORDERS = 2;

export interface ChartPoint {
  key: string;
  label: string;
  longLabel: string;
  /** null = draw no line here (a future hour, or no paid orders for an average). */
  value: number | null;
  /** The comparison day's figure for the same hour, when one is shown. */
  compare: number | null;
  partial: boolean;
  /** The hour/day/week/month isn't over yet (tooltip: "still running"). */
  running: boolean;
  /** For the tooltip: the bucket's revenue, orders and paid orders. */
  revenue: number;
  orders: number;
  paidOrders: number;
  /** Per-basket metric resting on 1–2 paid orders: drawn lighter, flagged in the tooltip. */
  fewOrders: boolean;
  /** Has a value but no drawn neighbour on either side — needs its own visible dot. */
  isolated: boolean;
  /** The faint dashed connector across a ONE-bucket gap (per-basket metrics
   *  only): the two points either side, plus their midpoint in the gap. */
  bridge: number | null;
}

/**
 * Chart points for one metric. Buckets that haven't started yet carry no
 * value, so today's line stops at "now" instead of diving to zero. When a
 * comparison series is given (last week's same day), its buckets are matched
 * by London hour of day, which survives a 23- or 25-hour clock-change day.
 */
export function chartPoints(series: TrendSeries, metric: TrendMetricId, comparison?: TrendSeries | null): ChartPoint[] {
  const m = TREND_METRICS[metric];
  const compareByHour = new Map<number, number | null>();
  if (comparison) {
    for (const b of comparison.buckets) {
      if (b.hourOfDay == null || compareByHour.has(b.hourOfDay)) continue;
      compareByHour.set(b.hourOfDay, b.future ? null : valueOrZero(b));
    }
  }
  // An hour (or day) with no paid orders is £0 AOV, drawn as a drop to zero
  // and back like Shopify's graphs, not a gap that looks broken (Graeme,
  // 2026-09-26). Spend-based metrics keep their gaps: there a gap means "no
  // spend figure yet", not zero. Hours still to come stay empty.
  function valueOrZero(b: TrendSeries["buckets"][number]): number | null {
    const v = m.value(b);
    return v == null && m.perBasket ? 0 : v;
  }
  const values = series.buckets.map(b => (b.future ? null : valueOrZero(b)));
  const bridge = m.perBasket ? bridgeOneGaps(values, series.buckets.map(b => b.future)) : values.map(() => null);
  return series.buckets.map((b, i) => {
    const value = values[i];
    return {
      key: b.key,
      label: b.label,
      longLabel: b.longLabel,
      value,
      compare: b.hourOfDay != null && compareByHour.has(b.hourOfDay) ? compareByHour.get(b.hourOfDay) ?? null : null,
      partial: b.partial && !b.future,
      running: b.running,
      revenue: b.revenue,
      orders: b.orders,
      paidOrders: b.paidOrders,
      fewOrders: !!m.perBasket && value != null && b.paidOrders > 0 && b.paidOrders <= FEW_ORDERS,
      isolated: value != null && (values[i - 1] ?? null) == null && (values[i + 1] ?? null) == null,
      bridge: bridge[i],
    };
  });
}

/**
 * The dashed connector series. Only a gap of exactly ONE bucket between two
 * real points is bridged — its value there is the midpoint, so the dashes
 * run straight between the two real points. Longer gaps stay empty: several
 * hours with no paid orders is worth seeing. Never bridges into the future.
 */
export function bridgeOneGaps(values: Array<number | null>, future: boolean[] = []): Array<number | null> {
  const out: Array<number | null> = values.map(() => null);
  for (let i = 1; i < values.length - 1; i++) {
    const before = values[i - 1];
    const after = values[i + 1];
    if (values[i] != null || before == null || after == null || future[i] || future[i + 1]) continue;
    out[i - 1] = before;
    out[i] = (before + after) / 2;
    out[i + 1] = after;
  }
  return out;
}

/** The one line under the big headline figure — how it was worked out. */
export function headlineNote(series: TrendSeries, metric: TrendMetricId): string {
  const t = series.totals;
  // Ratios draw a dashed line at the period figure — but only when there's a graph to draw it on.
  const dashed = unavailableReason(series, metric) == null ? " — the dashed line" : "";
  switch (metric) {
    case "revenue":
      return `${t.orders.toLocaleString("en-GB")} order${t.orders === 1 ? "" : "s"}`;
    case "aov":
      return t.paidOrders > 0
        ? `${GBP.format(t.revenue)} ÷ ${t.paidOrders.toLocaleString("en-GB")} paid order${t.paidOrders === 1 ? "" : "s"}${dashed}`
        : "No paid orders in this period";
    case "roas":
      if (t.roasPercent != null && t.adSpend != null) {
        return `${GBP.format(t.newCustomerRevenue)} ÷ ${GBP.format(t.adSpend)} spend${dashed}`;
      }
      if (t.spendDaysRecorded < t.spendDays) {
        const missing = t.spendDays - t.spendDaysRecorded;
        return `Waiting on ${missing} day${missing === 1 ? "" : "s"} of spend`;
      }
      return "No ad spend in this period — nothing to divide by";
    case "adSpend":
      return t.spendDaysRecorded < t.spendDays
        ? `${t.spendDaysRecorded} of ${t.spendDays} days recorded — gaps are days with no figure`
        : `All ${t.spendDays} days recorded`;
    case "subscriptionRevenue":
      return `${t.subscriptionOrders.toLocaleString("en-GB")} subscription orders, recurring and new combined`;
    case "newCustomerRevenue":
      return `${t.newCustomerOrders.toLocaleString("en-GB")} new-customer orders`;
    default:
      return "Total for the period";
  }
}

/** Why a graph can't be drawn at this grain, or null when it can. */
export function unavailableReason(series: TrendSeries, metric: TrendMetricId): string | null {
  if (TREND_METRICS[metric].daily && series.granularity === "hour") {
    return "Ad spend is recorded per day, so this can't be split by the hour. Pick Last 7 days or longer to see it over time.";
  }
  return null;
}
