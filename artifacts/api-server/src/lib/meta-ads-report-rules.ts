/**
 * The rules behind the Ads page (Graeme, 6 Nov 2026): what counts as live, and
 * how Meta's rows become one row per campaign, ad set or ad. Pure and tested;
 * the talking to Meta is meta-ads-report.ts. Objective I.
 *
 * The figures are defined to match Ads Manager's own columns:
 *   cost per result = spend ÷ website purchases
 *   purchase ROAS   = purchase value ÷ spend (Meta's own figure when it sends one)
 *   cost per reach  = spend ÷ reach, as a percentage (Graeme's custom column:
 *                     5 Nov 2026, £282.16 ÷ 16,350 = 1.73%, £575.44 ÷ 38,516 = 1.49%)
 *   hook rate       = 3-second video plays ÷ impressions (Graeme, 12 Nov 2026)
 *   hold rate       = ThruPlays ÷ impressions — ThruPlay is Meta's "played to
 *                     the end, or 15 seconds"
 * A static ad has no video plays, so no hook or hold rate (null, not 0%).
 *   new-customer ROAS (Meta) = purchase value ÷ spend on the "prospecting"
 *                     audience segment — people Meta didn't match to the
 *                     existing-customer list (Graeme, 12 Nov 2026). Meta's
 *                     estimate: an unmatched existing customer counts as new.
 */

export type AdLevel = "campaign" | "adset" | "ad";

/** What we ask Meta for. Which of these are really live is isLive()'s call. */
export const LIVE_FETCH_STATUSES = ["ACTIVE", "WITH_ISSUES"] as const;

export interface AdEntity {
  id: string;
  name: string;
  status: string;
  /** Null on a campaign. */
  campaignId: string | null;
  campaignName: string | null;
  /** Null unless this is an ad. */
  adSetId: string | null;
  adSetName: string | null;
  /** £ a day, when this level holds the budget. */
  dailyBudget: number | null;
  lifetimeBudget: number | null;
}

export interface AdFigures {
  spend: number;
  reach: number;
  impressions: number;
  /** Website purchases: what Ads Manager calls Results on these campaigns. */
  purchases: number;
  purchaseValue: number;
  linkClicks: number;
  frequency: number | null;
  cpm: number | null;
  ctr: number | null;
  roas: number | null;
  costPerResult: number | null;
  costPerReachPct: number | null;
  /** Video plays of at least 3 seconds; null when Meta reports none (a static ad). */
  videoPlays3s: number | null;
  /** Plays to the end or 15 seconds; null when Meta reports none. */
  thruPlays: number | null;
  /** 3-second plays ÷ impressions, as a percentage. */
  hookRatePct: number | null;
  /** ThruPlays ÷ impressions, as a percentage. */
  holdRatePct: number | null;
  /** Meta's new-customer split (prospecting segment); all null when Meta
   *  didn't answer the breakdown. */
  newCustomerSpend: number | null;
  newCustomerPurchases: number | null;
  newCustomerValue: number | null;
  newCustomerRoas: number | null;
}

export type AdRow = AdEntity & AdFigures & { level: AdLevel };

const NO_FIGURES: AdFigures = {
  spend: 0, reach: 0, impressions: 0, purchases: 0, purchaseValue: 0, linkClicks: 0,
  frequency: null, cpm: null, ctr: null, roas: null, costPerResult: null, costPerReachPct: null,
  videoPlays3s: null, thruPlays: null, hookRatePct: null, holdRatePct: null,
  newCustomerSpend: null, newCustomerPurchases: null, newCustomerValue: null, newCustomerRoas: null,
};

/** The audience segment Meta puts people it didn't match to the existing-customer list in. */
export const NEW_CUSTOMER_SEGMENT = "prospecting";

export interface SegmentFigures { spend: number; purchases: number; value: number }

/** Meta's insights broken down by user_segment_key, as each row's new-customer
 *  (prospecting) spend, purchases and value. An id Meta sent no prospecting
 *  row for spent nothing on new customers. */
export function newCustomerSegments(rows: unknown[], level: AdLevel | "account"): Map<string, SegmentFigures> {
  const out = new Map<string, SegmentFigures>();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (r["user_segment_key"] !== NEW_CUSTOMER_SEGMENT) continue;
    const id = str(r[ID_FIELD[level]]);
    if (!id) continue;
    const prev = out.get(id) ?? { spend: 0, purchases: 0, value: 0 };
    out.set(id, {
      spend: prev.spend + (num(r["spend"]) ?? 0),
      purchases: prev.purchases + (actionValue(r["actions"]) ?? 0),
      value: prev.value + (actionValue(r["action_values"]) ?? 0),
    });
  }
  return out;
}

/** The new-customer figures for one row. `segments` null = Meta didn't
 *  answer, so unknown rather than zero. */
export function withNewCustomers<T extends AdFigures>(figures: T, id: string, segments: Map<string, SegmentFigures> | null): T {
  if (!segments) return figures;
  const s = segments.get(id) ?? { spend: 0, purchases: 0, value: 0 };
  return {
    ...figures,
    newCustomerSpend: s.spend,
    newCustomerPurchases: s.purchases,
    newCustomerValue: s.value,
    newCustomerRoas: s.spend > 0 ? s.value / s.spend : null,
  };
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null);

/** Meta sends budgets in pence. */
const pounds = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n / 100 : null;
};

const fieldOf = (v: unknown, field: "id" | "name"): string | null =>
  v && typeof v === "object" ? str((v as Record<string, unknown>)[field]) : null;

/** One line of Meta's list of campaigns, ad sets or ads. Null if unreadable. */
export function parseEntity(raw: unknown): AdEntity | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r["id"]);
  if (!id) return null;
  return {
    id,
    name: str(r["name"]) ?? id,
    status: str(r["effective_status"]) ?? "UNKNOWN",
    campaignId: fieldOf(r["campaign"], "id"),
    campaignName: fieldOf(r["campaign"], "name"),
    adSetId: fieldOf(r["adset"], "id"),
    adSetName: fieldOf(r["adset"], "name"),
    dailyBudget: pounds(r["daily_budget"]),
    lifetimeBudget: pounds(r["lifetime_budget"]),
  };
}

interface MetaAction { action_type?: unknown; value?: unknown }

/** The first of these action types Meta reported. Ads Manager's Results on our
 *  campaigns are pixel purchases, so that comes first. */
const PURCHASE_ACTIONS = ["offsite_conversion.fb_pixel_purchase", "omni_purchase", "purchase"];

function actionValue(list: unknown): number | null {
  if (!Array.isArray(list)) return null;
  for (const type of PURCHASE_ACTIONS) {
    const hit = (list as MetaAction[]).find(a => a?.action_type === type);
    if (hit) return num(hit.value);
  }
  return null;
}

/** One named action's value — Meta reports a 3-second video play as "video_view". */
function oneAction(list: unknown, type: string): number | null {
  if (!Array.isArray(list)) return null;
  const hit = (list as MetaAction[]).find(a => a?.action_type === type);
  return hit ? num(hit.value) : null;
}

const pctOf = (part: number | null, whole: number): number | null =>
  part != null && whole > 0 ? (part / whole) * 100 : null;

const ID_FIELD: Record<AdLevel | "account", string> = { campaign: "campaign_id", adset: "adset_id", ad: "ad_id", account: "account_id" };

/** One insights row: Meta's strings, as the figures the page shows. */
export function parseInsight(raw: unknown, level: AdLevel | "account"): (AdFigures & { id: string }) | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r[ID_FIELD[level]]);
  if (!id) return null;

  const spend = num(r["spend"]) ?? 0;
  const reach = num(r["reach"]) ?? 0;
  const purchases = actionValue(r["actions"]) ?? 0;
  const purchaseValue = actionValue(r["action_values"]) ?? 0;
  const metaRoas = Array.isArray(r["purchase_roas"]) ? num((r["purchase_roas"] as MetaAction[])[0]?.value) : null;
  const impressions = num(r["impressions"]) ?? 0;
  const videoPlays3s = oneAction(r["actions"], "video_view");
  const thruPlays = oneAction(r["video_thruplay_watched_actions"], "video_view");

  return {
    id,
    spend,
    reach,
    impressions,
    purchases,
    purchaseValue,
    linkClicks: num(r["inline_link_clicks"]) ?? 0,
    frequency: num(r["frequency"]),
    cpm: num(r["cpm"]),
    ctr: num(r["ctr"]),
    roas: metaRoas ?? (spend > 0 ? purchaseValue / spend : null),
    costPerResult: purchases > 0 ? spend / purchases : null,
    costPerReachPct: reach > 0 ? (spend / reach) * 100 : null,
    videoPlays3s,
    thruPlays,
    hookRatePct: pctOf(videoPlays3s, impressions),
    holdRatePct: pctOf(thruPlays, impressions),
    newCustomerSpend: null,
    newCustomerPurchases: null,
    newCustomerValue: null,
    newCustomerRoas: null,
  };
}

/**
 * Is this on the page? ACTIVE, or flagged with issues while still spending.
 * Meta flags dozens of long-dead ads WITH_ISSUES on £0, and they would bury the
 * real ones, but an ad can have issues and still be running (6 Nov 2026:
 * "BF - Comparison Ad - Static – Copy", £108.89 in 7 days).
 */
export function isLive(status: string, spend: number): boolean {
  return status === "ACTIVE" || (status === "WITH_ISSUES" && spend > 0);
}

/** One level's rows: the live ones with their figures, biggest spend first. */
/** The whole account's figures for the period, blended by Meta itself (reach
 *  de-duplicated across campaigns; non-live campaigns' spend included). */
export function parseAccount(rows: unknown[], segments: Map<string, SegmentFigures> | null = null): AdFigures | null {
  const row = rows.length > 0 ? parseInsight(rows[0], "account") : null;
  if (!row) return null;
  const { id, ...figures } = row;
  return withNewCustomers(figures, id, segments);
}

export function mergeLevel(entities: unknown[], insights: unknown[], level: AdLevel, segments: Map<string, SegmentFigures> | null = null): AdRow[] {
  const figures = new Map<string, AdFigures>();
  for (const raw of insights) {
    const row = parseInsight(raw, level);
    if (row) figures.set(row.id, row);
  }
  const rows: AdRow[] = [];
  for (const raw of entities) {
    const entity = parseEntity(raw);
    if (!entity) continue;
    const f = figures.get(entity.id) ?? NO_FIGURES;
    if (isLive(entity.status, f.spend)) rows.push({ ...withNewCustomers(f, entity.id, segments), ...entity, level });
  }
  return rows.sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
}
