/**
 * The Ads page's colours (Graeme, 6 Nov 2026): one row from Meta against the
 * targets set on that page. Same scale and sums as the Numbers panels
 * (lib/numbers-benchmarks.ts). Pure, tested. Objective I.
 *
 * Each of the three figures gets its own colour, shown as a small dot. The
 * card's header colour is ROAS and cost per result averaged, the two that say
 * whether an ad is making money. Cost per reach doesn't feed it: an ad can be dear to show and still
 * sell well, and its figure climbs on longer periods as the same people are
 * only counted once.
 */
import { shadeAtRatio, type RoasShade } from "./ad-efficiency";
import { formatBenchmark, kpiRatio, kpiSpec, type BenchmarkMap } from "./numbers-benchmarks";

export type AdLevel = "campaign" | "adset" | "ad";

/** One row of GET /api/meta-ads/report. */
export interface AdRow {
  id: string;
  level: AdLevel;
  name: string;
  status: string;
  campaignId: string | null;
  campaignName: string | null;
  adSetId: string | null;
  adSetName: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  spend: number;
  reach: number;
  impressions: number;
  purchases: number;
  purchaseValue: number;
  linkClicks: number;
  frequency: number | null;
  cpm: number | null;
  ctr: number | null;
  roas: number | null;
  costPerResult: number | null;
  costPerReachPct: number | null;
  /** Video plays of 3s+ and ThruPlays; null on a static ad. */
  videoPlays3s?: number | null;
  thruPlays?: number | null;
  /** 3-second plays ÷ impressions, %. Null on a static ad. */
  hookRatePct?: number | null;
  /** ThruPlays ÷ impressions, %. Null on a static ad. */
  holdRatePct?: number | null;
}

/** The whole account's blended figures for the period (Meta's account row). */
export type AdFigures = Omit<AdRow, "id" | "level" | "name" | "status" | "campaignId" | "campaignName" | "adSetId" | "adSetName" | "dailyBudget" | "lifetimeBudget">;

/** An ad set and its ads. `adSet` is null when its ads are live but it isn't
 *  on the page itself (flagged with issues, on £0): they still need a home. */
export interface AdSetGroup {
  key: string;
  adSet: AdRow | null;
  name: string | null;
  ads: AdRow[];
}

export interface CampaignGroup {
  key: string;
  campaign: AdRow | null;
  name: string | null;
  adSets: AdSetGroup[];
}

/**
 * The page as folders (Graeme, 6 Nov 2026): each campaign holding its ad sets,
 * each ad set holding its ads, biggest spend first as they arrive. Grouped on
 * Meta's ids, never names: ad names repeat across ad sets.
 */
export function groupAds(campaigns: AdRow[], adSets: AdRow[], ads: AdRow[]): CampaignGroup[] {
  const groups = new Map<string, CampaignGroup>();
  const setsByKey = new Map<string, AdSetGroup>();

  const campaignGroup = (id: string | null, name: string | null) => {
    const key = id ?? "unknown";
    let group = groups.get(key);
    if (!group) {
      group = { key, campaign: null, name, adSets: [] };
      groups.set(key, group);
    }
    return group;
  };
  const adSetGroup = (parent: CampaignGroup, id: string | null, name: string | null) => {
    const key = `${parent.key}/${id ?? "unknown"}`;
    let group = setsByKey.get(key);
    if (!group) {
      group = { key, adSet: null, name, ads: [] };
      setsByKey.set(key, group);
      parent.adSets.push(group);
    }
    return group;
  };

  for (const row of campaigns) {
    const group = campaignGroup(row.id, row.name);
    group.campaign = row;
  }
  for (const row of adSets) {
    const group = adSetGroup(campaignGroup(row.campaignId, row.campaignName), row.id, row.name);
    group.adSet = row;
  }
  for (const row of ads) {
    adSetGroup(campaignGroup(row.campaignId, row.campaignName), row.adSetId, row.adSetName).ads.push(row);
  }
  return [...groups.values()];
}

export interface AdGrade {
  /** The card's colour. Null = grey, with a note saying why. */
  overall: RoasShade | null;
  costPerResult: RoasShade | null;
  roas: RoasShade | null;
  costPerReach: RoasShade | null;
  note: string | null;
}

const COST = kpiSpec("adsCostPerResult");
const ROAS = kpiSpec("adsPurchaseRoas");
const REACH = kpiSpec("adsCostPerReach");

const shade = (ratio: number | null | undefined) => (ratio == null ? null : shadeAtRatio(ratio));

export function gradeAd(row: Pick<AdRow, "spend" | "purchases" | "costPerResult" | "roas" | "costPerReachPct">, benchmarks: BenchmarkMap | undefined): AdGrade {
  const none = { overall: null, costPerResult: null, roas: null, costPerReach: null };
  if (!(row.spend > 0)) return { ...none, note: "No spend in this period" };

  const reach = shade(kpiRatio(row.costPerReachPct, benchmarks?.adsCostPerReach, REACH)?.ratio);
  const limit = benchmarks?.adsCostPerResult?.minimum;

  // Nothing sold yet, on less than one sale's worth of spend: that's not a
  // failing ad, just one that hasn't had its chance.
  if (row.purchases === 0 && limit != null && row.spend < limit) {
    return { ...none, costPerReach: reach, note: "Too early to tell" };
  }

  // Nothing sold on a full sale's spend or more is as bad as it gets.
  const costRatio = row.purchases === 0 && kpiRatio(1, benchmarks?.adsCostPerResult, COST)
    ? 0
    : kpiRatio(row.costPerResult, benchmarks?.adsCostPerResult, COST)?.ratio ?? null;
  const roasRatio = kpiRatio(row.roas, benchmarks?.adsPurchaseRoas, ROAS)?.ratio ?? null;

  const ratios = [costRatio, roasRatio].filter((r): r is number => r != null);
  const overall = ratios.length ? shadeAtRatio(ratios.reduce((a, b) => a + b, 0) / ratios.length) : null;
  return {
    overall,
    costPerResult: shade(costRatio),
    roas: shade(roasRatio),
    costPerReach: reach,
    note: overall ? null : "Set a target",
  };
}

export const money = (n: number | null | undefined) => (n == null ? "—" : formatBenchmark(n, "£p"));
export const roasText = (n: number | null | undefined) => (n == null ? "—" : formatBenchmark(n, "ratio"));
export const reachPctText = (n: number | null | undefined) => (n == null ? "—" : formatBenchmark(n, "%2"));
export const count = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-GB"));
/** "31.4%" — hook and hold rates. */
export const ratePct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);
