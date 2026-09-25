import { describe, it, expect } from "vitest";
import {
  band, pctLabel, trend, changeLabel, chartPoints, yDomain, lineOrder, totalPacks,
  parsePercentInput, percentInputValue, parseRangeQuery, rangeQuery, editCustomRange, startingCustomRange,
  rangeDays, previousRangeLabel, DEFAULT_CHOICE, type EffDay,
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
    expect(changeLabel(null)).toMatch(/Nothing counted in the 7 days before/);
    expect(changeLabel(5, "the 31 days before")).toBe("+5 points on the 31 days before");
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

describe("date range in the URL", () => {
  it("reads a custom range, a preset, or falls back to 3 months", () => {
    expect(parseRangeQuery("?from=2026-08-01&to=2026-08-31")).toEqual({ kind: "custom", from: "2026-08-01", to: "2026-08-31" });
    expect(parseRangeQuery("from=2026-08-01&to=2026-08-01")).toEqual({ kind: "custom", from: "2026-08-01", to: "2026-08-01" });
    expect(parseRangeQuery("?range=12m")).toEqual({ kind: "preset", range: "12m" });
    expect(parseRangeQuery("")).toEqual(DEFAULT_CHOICE);
    expect(parseRangeQuery("?from=2026-08-31&to=2026-08-01")).toEqual(DEFAULT_CHOICE); // end before start
    expect(parseRangeQuery("?from=2026-08-01")).toEqual(DEFAULT_CHOICE);
    expect(parseRangeQuery("?from=2026-02-30x&to=2026-03-01&range=6m")).toEqual({ kind: "preset", range: "6m" });
    expect(parseRangeQuery("?range=2y")).toEqual(DEFAULT_CHOICE);
  });
  it("writes the same query back", () => {
    expect(rangeQuery({ kind: "custom", from: "2026-08-01", to: "2026-08-31" })).toBe("from=2026-08-01&to=2026-08-31");
    expect(rangeQuery({ kind: "preset", range: "30d" })).toBe("range=30d");
    const c = { kind: "custom" as const, from: "2026-05-04", to: "2026-06-19" };
    expect(parseRangeQuery(rangeQuery(c))).toEqual(c);
  });
});

describe("custom range edits", () => {
  const bounds = { min: "2026-03-30", max: "2026-09-24" };
  const cur = { from: "2026-08-01", to: "2026-08-31" };
  it("keeps dates inside the computed history", () => {
    expect(editCustomRange(cur, "from", "2026-01-01", bounds)).toEqual({ from: "2026-03-30", to: "2026-08-31" });
    expect(editCustomRange(cur, "to", "2026-12-31", bounds)).toEqual({ from: "2026-08-01", to: "2026-09-24" });
  });
  it("moves the other end so the end is never before the start", () => {
    expect(editCustomRange(cur, "from", "2026-09-10", bounds)).toEqual({ from: "2026-09-10", to: "2026-09-10" });
    expect(editCustomRange(cur, "to", "2026-07-15", bounds)).toEqual({ from: "2026-07-15", to: "2026-07-15" });
  });
  it("ignores a cleared or half-typed date", () => {
    expect(editCustomRange(cur, "from", "", bounds)).toBe(cur);
    expect(editCustomRange(cur, "to", "2026-0", bounds)).toBe(cur);
  });
  it("starts from the range on screen, inside the history", () => {
    expect(startingCustomRange({ from: "2026-06-27", to: "2026-09-24" }, bounds, "2026-09-25")).toEqual({ from: "2026-06-27", to: "2026-09-24" });
    expect(startingCustomRange({ from: "2025-09-25", to: "2026-09-24" }, bounds, "2026-09-25")).toEqual({ from: "2026-03-30", to: "2026-09-24" });
    expect(startingCustomRange(null, { min: null, max: null }, "2026-09-25")).toEqual({ from: "2026-09-25", to: "2026-09-25" });
  });
  it("names the comparison period", () => {
    expect(rangeDays("2026-08-01", "2026-08-31")).toBe(31);
    expect(previousRangeLabel({ kind: "range", pct: 100, previousPct: 90, changePts: 10, from: "2026-08-01", to: "2026-08-31", previousFrom: "2026-07-01", previousTo: "2026-07-31" }))
      .toBe("the 31 days before (1 Jul – 31 Jul)");
    expect(previousRangeLabel({ kind: "range", pct: 100, previousPct: null, changePts: null, from: "2026-08-03", to: "2026-08-03" })).toBe("the day before");
  });
});
