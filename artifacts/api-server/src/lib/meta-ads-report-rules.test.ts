import { describe, expect, it } from "vitest";
import { isLive, mergeLevel, newCustomerSegments, parseAccount, parseEntity, parseInsight, withNewCustomers } from "./meta-ads-report-rules";

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
    expect(row).toMatchObject({ campaignId: "2", campaignName: "GC - TOF", adSetId: "3", adSetName: "General Main Ad set", dailyBudget: 550, lifetimeBudget: null });
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

describe("hook and hold rates (Graeme, 12 Nov 2026)", () => {
  it("hook = 3-second plays ÷ impressions, hold = ThruPlays ÷ impressions, as %", () => {
    const row = parseInsight({
      ad_id: "1", spend: "20", impressions: "4000",
      actions: [{ action_type: "video_view", value: "1200" }, { action_type: "omni_purchase", value: "1" }],
      video_thruplay_watched_actions: [{ action_type: "video_view", value: "320" }],
    }, "ad")!;
    expect(row.videoPlays3s).toBe(1200);
    expect(row.thruPlays).toBe(320);
    expect(row.hookRatePct).toBeCloseTo(30, 5);
    expect(row.holdRatePct).toBeCloseTo(8, 5);
  });

  it("a static ad has no hook or hold rate — not 0%", () => {
    const row = parseInsight(blackFriday, "campaign")!;
    expect(row.videoPlays3s).toBeNull();
    expect(row.hookRatePct).toBeNull();
    expect(row.holdRatePct).toBeNull();
  });

  it("no impressions, no rate", () => {
    const row = parseInsight({ ad_id: "1", actions: [{ action_type: "video_view", value: "3" }] }, "ad")!;
    expect(row.hookRatePct).toBeNull();
  });
});

describe("parseAccount", () => {
  it("the whole account's blended figures, from Meta's one account row", () => {
    const acct = parseAccount([{ ...blackFriday, campaign_id: undefined, account_id: "act_1" }])!;
    expect(acct.spend).toBe(39.77);
    expect(acct.costPerResult).toBeCloseTo(13.26, 2);
    expect(acct).not.toHaveProperty("id");
  });

  it("nothing spent: Meta sends no row, so no panel figures", () => {
    expect(parseAccount([])).toBeNull();
  });
});

describe("new-customer ROAS from Meta's audience segments (Graeme, 12 Nov 2026)", () => {
  // The shape Meta sent for the account on 12 Nov 2026 (last 7 days).
  const segRows = [
    { account_id: "1", user_segment_key: "existing", spend: "1001.29", actions: [{ action_type: "omni_purchase", value: "74" }], action_values: [{ action_type: "omni_purchase", value: "4175.55" }] },
    { account_id: "1", user_segment_key: "prospecting", spend: "3047.55", actions: [{ action_type: "omni_purchase", value: "101" }], action_values: [{ action_type: "omni_purchase", value: "5379.77" }] },
    { account_id: "1", user_segment_key: "unknown", spend: "0.15" },
  ];

  it("takes the prospecting segment only", () => {
    const s = newCustomerSegments(segRows, "account").get("1")!;
    expect(s).toEqual({ spend: 3047.55, purchases: 101, value: 5379.77 });
    const acct = parseAccount([{ account_id: "1", spend: "4048.99" }], newCustomerSegments(segRows, "account"))!;
    expect(acct.newCustomerRoas).toBeCloseTo(1.765, 3);
    expect(acct.newCustomerPurchases).toBe(101);
  });

  it("a row with no prospecting segment spent nothing on new customers: no ROAS, not 0", () => {
    const f = withNewCustomers(parseInsight({ ad_id: "9", spend: "5" }, "ad")!, "9", new Map());
    expect(f.newCustomerSpend).toBe(0);
    expect(f.newCustomerRoas).toBeNull();
  });

  it("when Meta didn't answer the split, the figures are unknown (null), not zero", () => {
    const f = withNewCustomers(parseInsight({ ad_id: "9", spend: "5" }, "ad")!, "9", null);
    expect(f.newCustomerSpend).toBeNull();
    expect(f.newCustomerRoas).toBeNull();
  });

  it("mergeLevel puts each ad's own split on it", () => {
    const rows = mergeLevel(
      [{ id: "a1", name: "Ad", effective_status: "ACTIVE" }],
      [{ ad_id: "a1", spend: "20", action_values: [{ action_type: "omni_purchase", value: "60" }] }],
      "ad",
      newCustomerSegments([{ ad_id: "a1", user_segment_key: "prospecting", spend: "15", action_values: [{ action_type: "omni_purchase", value: "30" }] }], "ad"),
    );
    expect(rows[0].newCustomerRoas).toBe(2);
    expect(rows[0].roas).toBe(3);
  });
});
