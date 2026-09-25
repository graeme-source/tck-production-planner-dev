import { describe, it, expect } from "vitest";
import {
  band, pctLabel, trend, changeLabel, chartPoints, yDomain, lineOrder, totalPacks,
  parsePercentInput, percentInputValue, type EffDay,
} from "./team-efficiency-view";

const day = (date: string, p: Partial<EffDay> = {}): EffDay => ({
  date, status: "ok", flags: [], packsByLine: { A: 400, B: 20 }, eightPackBags: 0,
  ordersDespatched: 100, packsDespatched: 300, efficiencyPct: 100, rollingPct: 100, ...p,
});

describe("bands and labels", () => {
  it("110% and up is great, under 90% is below", () => {
    expect(band(110)).toBe("great");
    expect(band(109.9)).toBe("on");
    expect(band(90)).toBe("on");
    expect(band(89.9)).toBe("below");
    expect(band(null)).toBe("none");
  });
  it("rounds percentages and shows a dash for nothing", () => {
    expect(pctLabel(106.6)).toBe("107%");
    expect(pctLabel(null)).toBe("—");
  });
  it("reads the headline change", () => {
    expect(trend(4.2)).toBe("up");
    expect(trend(-3)).toBe("down");
    expect(trend(0.4)).toBe("flat");
    expect(trend(null)).toBe("none");
    expect(changeLabel(4.4)).toBe("+4 points on the 7 days before");
    expect(changeLabel(-2.6)).toBe("−3 points on the 7 days before");
    expect(changeLabel(null)).toMatch(/No earlier/);
  });
});

describe("chartPoints", () => {
  it("drops the dot for a day that isn't counted but keeps the rolling line", () => {
    const pts = chartPoints([day("2026-09-21"), day("2026-09-22", { status: "excluded", efficiencyPct: 40, rollingPct: 101 })]);
    expect(pts[0].daily).toBe(100);
    expect(pts[1].daily).toBeNull();
    expect(pts[1].rolling).toBe(101);
  });
  it("always shows the 90/100/110 reference lines", () => {
    expect(yDomain(chartPoints([day("2026-09-21")]))).toEqual([80, 120]);
    expect(yDomain(chartPoints([day("2026-09-21", { efficiencyPct: 137, rollingPct: 64 })]))).toEqual([60, 140]);
  });
});

describe("table helpers", () => {
  it("orders lines by packs made", () => {
    expect(lineOrder([day("x", { packsByLine: { B: 5, A: 50 } }), day("y", { packsByLine: { C: 60 } })])).toEqual(["C", "A", "B"]);
    expect(totalPacks(day("x"))).toBe(420);
  });
});

describe("percent inputs", () => {
  it("turns a typed percentage into a rate and back", () => {
    expect(parsePercentInput("22")).toBe(0.22);
    expect(parsePercentInput("3.9%")).toBe(0.039);
    expect(parsePercentInput("abc")).toBeNull();
    expect(parsePercentInput("120")).toBeNull();
    expect(percentInputValue(0.039)).toBe("3.9");
    expect(percentInputValue(0.22)).toBe("22");
  });
});
