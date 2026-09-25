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

export type Granularity = "hour" | "day" | "week";

/** The per-bucket and whole-period figures (mirrors the server's TrendFigures). */
export interface TrendFigures {
  revenue: number;
  orders: number;
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
  value: (f: TrendFigures) => number | null;
}

export const TREND_METRICS: Record<TrendMetricId, TrendMetric> = {
  revenue: { id: "revenue", label: "Total sales", format: "money", kind: "total", daily: false, value: f => f.revenue },
  orders: { id: "orders", label: "Orders", format: "count", kind: "total", daily: false, value: f => f.orders },
  aov: { id: "aov", label: "Average order value", format: "money", kind: "ratio", daily: false, value: f => f.aov },
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
  return g === "hour" ? "By the hour" : g === "day" ? "Daily" : "Weekly";
}

export interface ChartPoint {
  key: string;
  label: string;
  longLabel: string;
  /** null = draw no line here (a future hour, or no orders for an average). */
  value: number | null;
  /** The comparison day's figure for the same hour, when one is shown. */
  compare: number | null;
  partial: boolean;
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
      compareByHour.set(b.hourOfDay, b.future ? null : m.value(b));
    }
  }
  return series.buckets.map(b => ({
    key: b.key,
    label: b.label,
    longLabel: b.longLabel,
    value: b.future ? null : m.value(b),
    compare: b.hourOfDay != null && compareByHour.has(b.hourOfDay) ? compareByHour.get(b.hourOfDay) ?? null : null,
    partial: b.partial && !b.future,
  }));
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
      return t.orders > 0
        ? `${GBP.format(t.revenue)} ÷ ${t.orders.toLocaleString("en-GB")} orders${dashed}`
        : "No orders in this period";
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
