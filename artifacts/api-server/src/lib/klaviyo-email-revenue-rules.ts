/**
 * Klaviyo-reported email revenue, flows vs campaigns (Graeme, 2026-11-09:
 * "the Klaviyo-reported revenue from email with the breakdown of flows
 * versus campaigns for any given period"). Objective I.
 *
 * Source: Klaviyo's metric aggregates on the Placed Order metric, grouped by
 * $attributed_channel and $attributed_flow — the same event-time figures as
 * Klaviyo's own "attributed revenue" on its home dashboard. An order
 * credited to email with a flow id is flow revenue; credited to email with
 * no flow it came from a campaign. SMS and other channels are left out.
 *
 * Pure: turns the aggregate rows into the card's figures.
 */

/** One row of a metric-aggregate response. */
export interface RawAggregateRow {
  dimensions?: Array<string | null>;
  measurements?: Record<string, Array<number | null> | undefined>;
}

export interface EmailRevenueFlow {
  flowId: string;
  revenue: number;
  orders: number;
}

export interface EmailRevenueSplit {
  revenue: number;
  orders: number;
  campaigns: { revenue: number; orders: number };
  flows: { revenue: number; orders: number };
  /** Each flow, biggest revenue first. */
  byFlow: EmailRevenueFlow[];
}

const EMAIL_CHANNEL = "$email_channel";

const sum = (xs: Array<number | null> | undefined) =>
  (xs ?? []).reduce<number>((a, v) => a + (typeof v === "number" && Number.isFinite(v) ? v : 0), 0);
const pence = (n: number) => Math.round(n * 100) / 100;

/** Rows grouped by [$attributed_channel, $attributed_flow] → the split. */
export function emailRevenueFromAggregates(rows: readonly RawAggregateRow[]): EmailRevenueSplit {
  const campaigns = { revenue: 0, orders: 0 };
  const flows = new Map<string, { revenue: number; orders: number }>();
  for (const r of rows) {
    const [channel, flowId] = r.dimensions ?? [];
    if (channel !== EMAIL_CHANNEL) continue;
    const revenue = sum(r.measurements?.["sum_value"]);
    const orders = sum(r.measurements?.["count"]);
    if (!flowId) {
      campaigns.revenue += revenue;
      campaigns.orders += orders;
    } else {
      const f = flows.get(flowId) ?? { revenue: 0, orders: 0 };
      f.revenue += revenue;
      f.orders += orders;
      flows.set(flowId, f);
    }
  }
  const byFlow = [...flows].map(([flowId, f]) => ({ flowId, revenue: pence(f.revenue), orders: Math.round(f.orders) }))
    .sort((a, b) => b.revenue - a.revenue);
  const flowTotal = byFlow.reduce((a, f) => ({ revenue: a.revenue + f.revenue, orders: a.orders + f.orders }), { revenue: 0, orders: 0 });
  return {
    revenue: pence(campaigns.revenue + flowTotal.revenue),
    orders: Math.round(campaigns.orders + flowTotal.orders),
    campaigns: { revenue: pence(campaigns.revenue), orders: Math.round(campaigns.orders) },
    flows: { revenue: pence(flowTotal.revenue), orders: flowTotal.orders },
    byFlow,
  };
}

/** "2026-11-09" → "2026-11-10": the aggregate filter's end is exclusive. */
export function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The two datetime filters for London days from..to inclusive. */
export function aggregateFilters(from: string, to: string): string[] {
  return [`greater-or-equal(datetime,${from}T00:00:00)`, `less-than(datetime,${nextDay(to)}T00:00:00)`];
}
