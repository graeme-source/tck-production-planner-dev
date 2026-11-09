/**
 * Klaviyo email revenue for an Order Analysis period — flows vs campaigns.
 * READ-ONLY: metric aggregates and flow names are reads; nothing is written
 * to Klaviyo. Uses the founder's read-only key (founder_settings
 * klaviyo_api_key), as the email calendar does.
 *
 * Each from..to is kept 10 minutes (5 while it includes today) and shared
 * by every viewer, so flicking between periods doesn't hammer Klaviyo.
 * Maths: klaviyo-email-revenue-rules.ts (pure, tested).
 */
import { getKlaviyoKey, kFetch, placedOrderMetricId } from "./klaviyo-campaign-calendar";
import {
  aggregateFilters, emailRevenueFromAggregates, type EmailRevenueSplit, type RawAggregateRow,
} from "./klaviyo-email-revenue-rules";

export type EmailRevenueReport =
  | { connected: false }
  | { connected: true; ok: false; message: string }
  | {
    connected: true; ok: true; from: string; to: string; fetchedAt: string;
    split: Omit<EmailRevenueSplit, "byFlow"> & { byFlow: Array<EmailRevenueSplit["byFlow"][number] & { name: string }> };
  };

const cache = new Map<string, { at: number; report: EmailRevenueReport }>();
const londonToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

// Flow names barely change — an hour.
const flowNames = new Map<string, { name: string; at: number }>();
async function flowName(apiKey: string, id: string): Promise<string> {
  const hit = flowNames.get(id);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.name;
  let name = `Flow ${id}`;
  try {
    const r = await kFetch<{ data?: { attributes?: { name?: string } } }>(apiKey, `/api/flows/${id}?fields[flow]=name`);
    name = r.data?.attributes?.name || name;
  } catch { /* deleted flow, or no flows:read scope — keep the id */ }
  flowNames.set(id, { name, at: Date.now() });
  return name;
}

async function load(apiKey: string, from: string, to: string): Promise<EmailRevenueReport> {
  const metricId = await placedOrderMetricId(apiKey);
  const rows: RawAggregateRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 5; page++) {
    const r: { data?: { attributes?: { data?: RawAggregateRow[] } }; links?: { next?: string | null } } = await kFetch(apiKey, "/api/metric-aggregates/", {
      body: {
        data: {
          type: "metric-aggregate",
          attributes: {
            metric_id: metricId,
            measurements: ["sum_value", "count"],
            by: ["$attributed_channel", "$attributed_flow"],
            interval: "month",
            timezone: "Europe/London",
            filter: aggregateFilters(from, to),
            page_size: 500,
            ...(cursor ? { page_cursor: cursor } : {}),
          },
        },
      },
    });
    rows.push(...(r.data?.attributes?.data ?? []));
    const next = r.links?.next;
    cursor = next ? new URL(next).searchParams.get("page_cursor") : null;
    if (!cursor) break;
  }
  const split = emailRevenueFromAggregates(rows);
  const byFlow = await Promise.all(split.byFlow.map(async f => ({ ...f, name: await flowName(apiKey, f.flowId) })));
  return { connected: true, ok: true, from, to, fetchedAt: new Date().toISOString(), split: { ...split, byFlow } };
}

export async function getEmailRevenue(from: string, to: string, refresh = false): Promise<EmailRevenueReport> {
  const apiKey = await getKlaviyoKey();
  if (!apiKey) return { connected: false };
  const key = `${from}|${to}`;
  const ttl = to >= londonToday() ? 5 * 60_000 : 10 * 60_000;
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < ttl) return hit.report;
  try {
    const report = await load(apiKey, from, to);
    cache.set(key, { at: Date.now(), report });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return report;
  } catch (err) {
    console.error("[klaviyo] email revenue failed:", err instanceof Error ? err.message : err);
    // A good earlier figure beats an error.
    if (hit?.report && "ok" in hit.report && hit.report.ok) return hit.report;
    return { connected: true, ok: false, message: "Klaviyo didn't answer just now" };
  }
}
