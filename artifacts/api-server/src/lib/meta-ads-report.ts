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
import { LIVE_FETCH_STATUSES, mergeLevel, type AdLevel, type AdRow } from "./meta-ads-report-rules";
import { notConnectedMessage, readMetaAdsConfig } from "./meta-ads-sync";

const CACHE_MS = 5 * 60_000;
/** Custom ranges each take a slot, so this can't grow without end. */
const CACHE_MAX = 30;

export type AdsReport =
  | { connected: false; ok: true; message: string }
  | { connected: true; ok: false; message: string }
  | { connected: true; ok: true; from: string; to: string; fetchedAt: string; campaigns: AdRow[]; adSets: AdRow[]; ads: AdRow[] };

const INSIGHT_FIELDS = "spend,reach,impressions,frequency,cpm,ctr,inline_link_clicks,purchase_roas,actions,action_values";

const LEVELS = {
  campaign: { edge: "campaigns", idField: "campaign_id", fields: "id,name,effective_status,daily_budget,lifetime_budget" },
  adset: { edge: "adsets", idField: "adset_id", fields: "id,name,effective_status,daily_budget,lifetime_budget,campaign{id,name}" },
  ad: { edge: "ads", idField: "ad_id", fields: "id,name,effective_status,campaign{id,name},adset{id,name}" },
} as const satisfies Record<AdLevel, { edge: string; idField: string; fields: string }>;

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
  const [entities, rows] = await Promise.all([
    graphGetAll(cfg, `${base}/${edge}?${list}`),
    graphGetAll(cfg, `${base}/insights?${insights}`),
  ]);
  return mergeLevel(entities, rows, level);
}

const cache = new Map<string, { at: number; report: AdsReport }>();
const inFlight = new Map<string, Promise<AdsReport>>();

async function build(cfg: ConnectedMetaConfig, from: string, to: string): Promise<AdsReport> {
  try {
    const [campaigns, adSets, ads] = await Promise.all([
      fetchLevel(cfg, "campaign", from, to),
      fetchLevel(cfg, "adset", from, to),
      fetchLevel(cfg, "ad", from, to),
    ]);
    return { connected: true, ok: true, from, to, fetchedAt: new Date().toISOString(), campaigns, adSets, ads };
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
