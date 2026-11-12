import { describe, expect, it } from "vitest";
import { gradeAd, gradeNewCustomerRoas, groupAds, money, reachPctText, roasText, type AdRow } from "./ads-page";
import { shadeAtRatio } from "./ad-efficiency";
import type { BenchmarkMap } from "./numbers-benchmarks";

const targets: BenchmarkMap = {
  adsCostPerResult: { minimum: 20, stretch: 16 },
  adsPurchaseRoas: { minimum: 2.8, stretch: 3.5 },
  adsCostPerReach: { minimum: 2.5, stretch: 2 },
};

const row = (over: Partial<AdRow>): AdRow => ({
  id: "1", level: "ad", name: "Ad", status: "ACTIVE", campaignId: null, campaignName: null, adSetId: null, adSetName: null, dailyBudget: null, lifetimeBudget: null,
  spend: 100, reach: 5000, impressions: 8000, purchases: 5, purchaseValue: 280, linkClicks: 90, frequency: 1.6, cpm: 12.5, ctr: 1.2,
  roas: 2.8, costPerResult: 20, costPerReachPct: 2, ...over,
});

describe("gradeAd", () => {
  it("colours each figure, and the card from ROAS and cost per result together", () => {
    const g = gradeAd(row({}), targets);
    expect(g.roas?.hex).toBe(shadeAtRatio(1).hex);
    expect(g.costPerResult?.hex).toBe(shadeAtRatio(1).hex);
    expect(g.overall?.hex).toBe(shadeAtRatio(1).hex);
    expect(g.note).toBeNull();
  });

  it("averages the two, so one great figure lifts a poor one", () => {
    const g = gradeAd(row({ roas: 3.5, costPerResult: 24 }), targets);
    expect(g.overall!.step).toBeGreaterThan(g.costPerResult!.step);
    expect(g.overall!.step).toBeLessThan(g.roas!.step);
  });

  it("leaves cost per reach out of the card's colour", () => {
    const cheap = gradeAd(row({ costPerReachPct: 1 }), targets);
    const dear = gradeAd(row({ costPerReachPct: 9 }), targets);
    expect(cheap.overall?.hex).toBe(dear.overall?.hex);
    expect(cheap.costPerReach!.step).toBeGreaterThan(dear.costPerReach!.step);
  });

  it("treats a cheaper cost per result as better", () => {
    expect(gradeAd(row({ costPerResult: 14 }), targets).costPerResult!.step)
      .toBeGreaterThan(gradeAd(row({ costPerResult: 30 }), targets).costPerResult!.step);
  });

  it("stays grey with no spend", () => {
    const g = gradeAd(row({ spend: 0, purchases: 0, roas: null, costPerResult: null, costPerReachPct: null }), targets);
    expect(g.overall).toBeNull();
    expect(g.note).toBe("No spend in this period");
  });

  it("calls it too early when nothing has sold on less than a sale's worth of spend", () => {
    const g = gradeAd(row({ spend: 4.54, purchases: 0, roas: 0, costPerResult: null }), targets);
    expect(g.overall).toBeNull();
    expect(g.note).toBe("Too early to tell");
    expect(g.costPerReach).not.toBeNull();
  });

  it("goes dark red when nothing has sold on a full sale's spend", () => {
    const g = gradeAd(row({ spend: 45, purchases: 0, roas: 0, costPerResult: null }), targets);
    expect(g.overall?.hex).toBe(shadeAtRatio(0).hex);
    expect(g.costPerResult?.hex).toBe(shadeAtRatio(0).hex);
  });

  it("asks for a target when there are none", () => {
    const g = gradeAd(row({}), {});
    expect(g.overall).toBeNull();
    expect(g.note).toBe("Set a target");
  });

  it("uses the one target that's set", () => {
    const g = gradeAd(row({}), { adsPurchaseRoas: targets.adsPurchaseRoas });
    expect(g.overall?.hex).toBe(shadeAtRatio(1).hex);
    expect(g.costPerResult).toBeNull();
  });
});

describe("groupAds", () => {
  const campaign = (id: string, name: string) => row({ id, name, level: "campaign" });
  const adSet = (id: string, name: string, campaignId: string) => row({ id, name, level: "adset", campaignId, campaignName: `Campaign ${campaignId}` });
  const ad = (id: string, name: string, adSetId: string, campaignId: string) =>
    row({ id, name, adSetId, adSetName: `Set ${adSetId}`, campaignId, campaignName: `Campaign ${campaignId}` });

  it("puts each ad set in its campaign and each ad in its ad set, keeping the spend order", () => {
    const groups = groupAds(
      [campaign("c1", "First"), campaign("c2", "Second")],
      [adSet("s3", "Big", "c2"), adSet("s1", "Main", "c1"), adSet("s2", "Small", "c1")],
      [ad("a1", "One", "s1", "c1"), ad("a2", "Two", "s3", "c2"), ad("a3", "Three", "s1", "c1"), ad("a4", "Four", "s2", "c1")],
    );
    expect(groups.map(g => g.campaign?.name)).toEqual(["First", "Second"]);
    expect(groups[0]!.adSets.map(s => s.adSet?.name)).toEqual(["Main", "Small"]);
    expect(groups[0]!.adSets[0]!.ads.map(a => a.name)).toEqual(["One", "Three"]);
    expect(groups[1]!.adSets[0]!.ads.map(a => a.name)).toEqual(["Two"]);
  });

  it("goes by id, so ads with the same name stay in their own ad sets", () => {
    const groups = groupAds(
      [campaign("c1", "First")],
      [adSet("s1", "A", "c1"), adSet("s2", "B", "c1")],
      [ad("a1", "Philly ASMR Ad", "s1", "c1"), ad("a2", "Philly ASMR Ad", "s2", "c1")],
    );
    expect(groups[0]!.adSets.map(s => s.ads.map(a => a.id))).toEqual([["a1"], ["a2"]]);
  });

  it("keeps a campaign with nothing live inside it", () => {
    const groups = groupAds([campaign("c1", "First")], [], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.adSets).toEqual([]);
  });

  it("gives a live ad a home when its ad set isn't on the page", () => {
    const groups = groupAds([campaign("c1", "First")], [], [ad("a1", "Lost", "s9", "c1")]);
    expect(groups[0]!.adSets[0]).toMatchObject({ adSet: null, name: "Set s9" });
    expect(groups[0]!.adSets[0]!.ads.map(a => a.id)).toEqual(["a1"]);
  });

  it("gives a live ad set a home when its campaign isn't on the page, after the live campaigns", () => {
    const groups = groupAds([campaign("c1", "First")], [adSet("s1", "Stray", "c9")], []);
    expect(groups.map(g => g.key)).toEqual(["c1", "c9"]);
    expect(groups[1]).toMatchObject({ campaign: null, name: "Campaign c9" });
  });
});

describe("formats", () => {
  it("shows the units Ads Manager's figures are read in", () => {
    expect(money(13.2)).toBe("£13.20");
    expect(money(1234.5)).toBe("£1,234.50");
    expect(roasText(2.261)).toBe("2.26");
    expect(reachPctText(1.7258)).toBe("1.73%");
    expect(money(null)).toBe("—");
  });
});

describe("new-customer ROAS colour (Graeme, 12 Nov 2026)", () => {
  const nc: BenchmarkMap = { ...targets, newCustomerRoas: { minimum: 210, stretch: 250 } } as BenchmarkMap;
  it("is graded against the New customer ROAS target, a %", () => {
    // A ratio (1.77) is compared with the % target (210): 1.77 is under the
    // minimum, 2.10 is on it, 2.60 is past the stretch — three different colours,
    // and 2.10 is the same colour as the Numbers card gives 210%.
    const under = gradeNewCustomerRoas(1.77, nc)!.hex, on = gradeNewCustomerRoas(2.1, nc)!.hex, past = gradeNewCustomerRoas(2.6, nc)!.hex;
    expect(new Set([under, on, past]).size).toBe(3);
    expect(on).toBe(shadeAtRatio(1).hex);
  });
  it("no figure or no target, no colour", () => {
    expect(gradeNewCustomerRoas(null, nc)).toBeNull();
    expect(gradeNewCustomerRoas(2, { ...targets } as BenchmarkMap)).toBeNull();
  });
});
