import { describe, expect, it } from "vitest";
import { isLive, mergeLevel, parseEntity, parseInsight } from "./meta-ads-report-rules";

// The shape Meta's insights edge sends, with the Black Friday campaign's real
// figures from 6 Nov 2026, which Ads Manager showed as 3 results at £13.26.
const blackFriday = {
  campaign_id: "52556224164933",
  spend: "39.77",
  reach: "2127",
  impressions: "2697",
  frequency: "1.268",
  cpm: "14.75",
  ctr: "1.5",
  inline_link_clicks: "31",
  purchase_roas: [{ action_type: "omni_purchase", value: "4.097812" }],
  actions: [
    { action_type: "link_click", value: "31" },
    { action_type: "omni_purchase", value: "3" },
    { action_type: "offsite_conversion.fb_pixel_purchase", value: "3" },
  ],
  action_values: [{ action_type: "omni_purchase", value: "162.97" }],
};

describe("parseInsight", () => {
  it("matches the Ads Manager columns", () => {
    const row = parseInsight(blackFriday, "campaign")!;
    expect(row.purchases).toBe(3);
    expect(row.costPerResult).toBeCloseTo(13.26, 2);
    expect(row.roas).toBeCloseTo(4.0978, 3);
    expect(row.purchaseValue).toBe(162.97);
    expect(row.linkClicks).toBe(31);
  });

  it("works out cost per reach as Graeme's Ads Manager column does: spend ÷ reach, as a %", () => {
    // Both campaigns on 5 Nov 2026, which that column showed as 1.73% and 1.49%.
    expect(parseInsight({ campaign_id: "1", spend: "282.16", reach: "16350" }, "campaign")!.costPerReachPct!.toFixed(2)).toBe("1.73");
    expect(parseInsight({ campaign_id: "2", spend: "575.44", reach: "38516" }, "campaign")!.costPerReachPct!.toFixed(2)).toBe("1.49");
  });

  it("prefers pixel purchases, which is what Results counts", () => {
    const row = parseInsight({
      ad_id: "1", spend: "10", actions: [
        { action_type: "omni_purchase", value: "5" },
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "4" },
      ],
    }, "ad")!;
    expect(row.purchases).toBe(4);
    expect(row.costPerResult).toBe(2.5);
  });

  it("has no cost per result or reach to divide by when nothing happened", () => {
    const row = parseInsight({ ad_id: "1", spend: "4.54" }, "ad")!;
    expect(row.purchases).toBe(0);
    expect(row.costPerResult).toBeNull();
    expect(row.costPerReachPct).toBeNull();
    expect(row.roas).toBe(0);
  });

  it("works ROAS out from the value when Meta sends none", () => {
    const row = parseInsight({ adset_id: "1", spend: "10", action_values: [{ action_type: "omni_purchase", value: "25" }] }, "adset")!;
    expect(row.roas).toBe(2.5);
  });

  it("reads the id for the level asked for, and refuses a row without one", () => {
    expect(parseInsight({ adset_id: "9", spend: "1" }, "adset")?.id).toBe("9");
    expect(parseInsight({ adset_id: "9", spend: "1" }, "ad")).toBeNull();
    expect(parseInsight(null, "ad")).toBeNull();
  });
});

describe("parseEntity", () => {
  it("reads names, parents and budgets (Meta's budgets are in pence)", () => {
    const row = parseEntity({
      id: "1", name: "TN-Reviews", effective_status: "ACTIVE", daily_budget: "55000",
      campaign: { id: "2", name: "GC - TOF" }, adset: { id: "3", name: "General Main Ad set" },
    })!;
    expect(row).toMatchObject({ campaignName: "GC - TOF", adSetName: "General Main Ad set", dailyBudget: 550, lifetimeBudget: null });
  });
});

describe("isLive", () => {
  it("keeps ACTIVE ads even on £0, like Delivery: Active in Ads Manager", () => {
    expect(isLive("ACTIVE", 0)).toBe(true);
  });
  it("keeps an ad with issues only while it's spending", () => {
    expect(isLive("WITH_ISSUES", 108.89)).toBe(true);
    expect(isLive("WITH_ISSUES", 0)).toBe(false);
  });
  it("drops anything else", () => {
    expect(isLive("PAUSED", 50)).toBe(false);
  });
});

describe("mergeLevel", () => {
  const entities = [
    { id: "a", name: "Small", effective_status: "ACTIVE" },
    { id: "b", name: "Big", effective_status: "ACTIVE" },
    { id: "c", name: "New, no spend", effective_status: "ACTIVE" },
    { id: "d", name: "Old dead ad", effective_status: "WITH_ISSUES" },
    { id: "e", name: "Paused since", effective_status: "PAUSED" },
    { name: "No id" },
  ];
  const insights = [
    { ad_id: "a", spend: "5" }, { ad_id: "b", spend: "50" }, { ad_id: "e", spend: "99" }, { ad_id: "gone", spend: "12" },
  ];

  it("shows only what's live, biggest spend first, with the figures joined on", () => {
    const rows = mergeLevel(entities, insights, "ad");
    expect(rows.map(r => r.name)).toEqual(["Big", "Small", "New, no spend"]);
    expect(rows[0]).toMatchObject({ level: "ad", spend: 50 });
    expect(rows[2]).toMatchObject({ spend: 0, roas: null });
  });
});
