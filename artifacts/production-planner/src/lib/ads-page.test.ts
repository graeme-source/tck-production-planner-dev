import { describe, expect, it } from "vitest";
import { gradeAd, money, reachPctText, roasText, type AdRow } from "./ads-page";
import { shadeAtRatio } from "./ad-efficiency";
import type { BenchmarkMap } from "./numbers-benchmarks";

const targets: BenchmarkMap = {
  adsCostPerResult: { minimum: 20, stretch: 16 },
  adsPurchaseRoas: { minimum: 2.8, stretch: 3.5 },
  adsCostPerReach: { minimum: 2.5, stretch: 2 },
};

const row = (over: Partial<AdRow>): AdRow => ({
  id: "1", level: "ad", name: "Ad", status: "ACTIVE", campaignName: null, adSetName: null, dailyBudget: null, lifetimeBudget: null,
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

describe("formats", () => {
  it("shows the units Ads Manager's figures are read in", () => {
    expect(money(13.2)).toBe("£13.20");
    expect(money(1234.5)).toBe("£1,234.50");
    expect(roasText(2.261)).toBe("2.26");
    expect(reachPctText(1.7258)).toBe("1.73%");
    expect(money(null)).toBe("—");
  });
});
