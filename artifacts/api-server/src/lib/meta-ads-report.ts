/**
 * The feed behind the Ads page (Graeme, 6 Nov 2026): which campaigns, ad sets
 * and ads are live, and their figures for a period. Rules: meta-ads-report-rules.ts.
 * Objective I.
 *
 * Reads only: nothing here changes anything in the ad account. Nothing is
 * stored either, so the page always shows what Meta says, at most five
 * minutes old unless someone presses Refresh.
 */
import { GRAPH_HOST, graphGetAll, type ConnectedMetaConfig } from "./meta-ads";
import { LIVE_FETCH_STATUSES, mergeLevel, newCustomerSegments, parseAccount, type AdFigures, type AdLevel, type AdRow, type SegmentFigures } from "./meta-ads-report-rules";
import { getCachedOrdersLondonDays } from "./orders-cache";
import { newVsReturningTotals } from "./order-revenue";
import { notConnectedMessage, readMetaAdsConfig } from "./meta-ads-sync";

const CACHE_MS = 5 * 60_000;
/** Custom ranges each take a slot, so this can't grow without end. */
const CACHE_MAX = 30;

export type AdsReport =
  | { connected: false; ok: true; message: string }
  | { connected: true; ok: false; message: string }
  | {
    connected: true; ok: true; from: string; to: string; fetchedAt: string;
    account: AdFigures | null;
    /** The real new-customer figure: Shopify's new-customer orders for the
     *  period (the one "new-customer" tag rule) ÷ the account's Meta spend. */
    shopifyNewCustomers: { revenue: number; orders: number; roas: number | null } | null;
    campaigns: AdRow[]; adSets: AdRow[]; ads: AdRow[];
  };

const INSIGHT_FIELDS = "spend,reach,impressions,frequency,cpm,ctr,inline_link_clicks,purchase_roas,actions,action_values,video_thruplay_watched_actions";

const LEVELS = {
  campaign: { edge: "campaigns", idField: "campaign_id", fields: "id,name,effective_status,daily_budget,lifetime_budget" },
  adset: { edge: "adsets", idField: "adset_id", fields: "id,name,effective_status,daily_budget,lifetime_budget,campaign{id,name}" },
  ad: { edge: "ads", idField: "ad_id", fields: "id,name,effective_status,campaign{id,name},adset{id,name}" },
} as const satisfies Record<AdLevel, { edge: string; idField: string; fields: string }>;

/** Meta's new-customer split for a level (breakdown by audience segment).
 *  Null when Meta won't answer, so the page shows "—" rather than £0, and
 *  the rest of the report still loads. */
async function fetchSegments(cfg: ConnectedMetaConfig, level: AdLevel | "account", from: string, to: string): Promise<Map<string, SegmentFigures> | null> {
  const idField = level === "account" ? "account_id" : LEVELS[level].idField;
  const insights = new URLSearchParams({
    level,
    breakdowns: "user_segment_key",
    fields: `${idField},spend,actions,action_values`,
    limit: "500",
    time_range: JSON.stringify({ since: from, until: to }),
    use_unified_attribution_setting: "true",
    action_report_time: "mixed",
  });
  try {
    return newCustomerSegments(await graphGetAll(cfg, `${GRAPH_HOST}/${cfg.graphVersion}/${cfg.accountId}/insights?${insights}`), level);
  } catch (err) {
    console.error(`[meta-ads] new-customer split (${level}) failed:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function fetchLevel(cfg: ConnectedMetaConfig, level: AdLevel, from: string, to: string): Promise<AdRow[]> {
  const { edge, idField, fields } = LEVELS[level];
  const base = `${GRAPH_HOST}/${cfg.graphVersion}/${cfg.accountId}`;
  const list = new URLSearchParams({
    fields,
    limit: "500",
    effective_status: JSON.stringify(LIVE_FETCH_STATUSES),
  });
  const insights = new URLSearchParams({
    level,
    fields: `${idField},${INSIGHT_FIELDS}`,
    limit: "500",
    time_range: JSON.stringify({ since: from, until: to }),
    // Each ad set's own attribution setting, as Ads Manager reports it. Left
    // out, Meta applies one default to everything and the figures disagree.
    use_unified_attribution_setting: "true",
    action_report_time: "mixed",
  });
  const [entities, rows, segments] = await Promise.all([
    graphGetAll(cfg, `${base}/${edge}?${list}`),
    graphGetAll(cfg, `${base}/insights?${insights}`),
    fetchSegments(cfg, level, from, to),
  ]);
  return mergeLevel(entities, rows, level, segments);
}

/** The account's own blended figures for the period (Graeme, 12 Nov 2026:
 *  one panel of CPA, spend, ROAS and reach across the whole account). */
async function fetchAccount(cfg: ConnectedMetaConfig, from: string, to: string): Promise<AdFigures | null> {
  const insights = new URLSearchParams({
    level: "account",
    fields: `account_id,${INSIGHT_FIELDS}`,
    time_range: JSON.stringify({ since: from, until: to }),
    use_unified_attribution_setting: "true",
    action_report_time: "mixed",
  });
  const [rows, segments] = await Promise.all([
    graphGetAll(cfg, `${GRAPH_HOST}/${cfg.graphVersion}/${cfg.accountId}/insights?${insights}`),
    fetchSegments(cfg, "account", from, to),
  ]);
  return parseAccount(rows, segments);
}

/** Shopify's new-customer orders for the period ÷ Meta spend. Null if the
 *  orders can't be read, so the page says so rather than showing 0. */
async function shopifyNewCustomers(from: string, to: string, spend: number | null): Promise<{ revenue: number; orders: number; roas: number | null } | null> {
  try {
    const t = newVsReturningTotals(await getCachedOrdersLondonDays(from, to));
    return { revenue: t.newCustomerRevenue, orders: t.newCustomerOrders, roas: spend && spend > 0 ? t.newCustomerRevenue / spend : null };
  } catch (err) {
    console.error("[meta-ads] Shopify new customers failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

const cache = new Map<string, { at: number; report: AdsReport }>();
const inFlight = new Map<string, Promise<AdsReport>>();

async function build(cfg: ConnectedMetaConfig, from: string, to: string): Promise<AdsReport> {
  try {
    const [account, campaigns, adSets, ads] = await Promise.all([
      fetchAccount(cfg, from, to),
      fetchLevel(cfg, "campaign", from, to),
      fetchLevel(cfg, "adset", from, to),
      fetchLevel(cfg, "ad", from, to),
    ]);
    const shopify = await shopifyNewCustomers(from, to, account?.spend ?? null);
    return { connected: true, ok: true, from, to, fetchedAt: new Date().toISOString(), account, shopifyNewCustomers: shopify, campaigns, adSets, ads };
  } catch (err) {
    console.error("[meta-ads] ads report failed:", err instanceof Error ? err.message : String(err));
    return { connected: true, ok: false, message: "Couldn't reach Meta just now. Try Refresh in a moment." };
  }
}

/** Never throws: a failure is a report saying so, and isn't cached. */
export async function getAdsReport(from: string, to: string, refresh = false): Promise<AdsReport> {
  const cfg = readMetaAdsConfig(process.env);
  if (!cfg.connected) return { connected: false, ok: true, message: notConnectedMessage(cfg.reason) };

  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < CACHE_MS) return hit.report;

  // Two people, or a Refresh on top of the page's own timer, share one trip.
  const running = inFlight.get(key);
  if (running) return running;

  const trip = build(cfg, from, to)
    .then(report => {
      if (report.ok) {
        cache.delete(key);
        cache.set(key, { at: Date.now(), report });
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
      }
      return report;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, trip);
  return trip;
}
