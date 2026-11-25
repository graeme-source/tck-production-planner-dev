import { describe, it, expect } from "vitest";
import {
  valueOnLabourPct, labourShareOfValuePct,
  band, pctLabel, trend, changeLabel, chartPoints, yDomain, lineOrder, totalPacks,
  parsePercentInput, percentInputValue, parseRangeQuery, rangeQuery, editCustomRange,
  rangeDays, previousRangeLabel, DEFAULT_CHOICE, UNAVAILABLE_PRESETS, choiceWindow, reportQuery, todayMessage, asOfLabel, type EffDay,
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

describe("date range in the URL (the standard period picker)", () => {
  it("reads a custom range, a preset, or falls back to Last 3 months", () => {
    expect(DEFAULT_CHOICE).toEqual({ kind: "preset", id: "last3Months" });
    expect(parseRangeQuery("?from=2026-08-01&to=2026-08-31")).toEqual({ kind: "custom", from: "2026-08-01", to: "2026-08-31" });
    expect(parseRangeQuery("from=2026-08-01&to=2026-08-01")).toEqual({ kind: "custom", from: "2026-08-01", to: "2026-08-01" });
    expect(parseRangeQuery("?period=last12Months")).toEqual({ kind: "preset", id: "last12Months" });
    expect(parseRangeQuery("?period=lastMonth")).toEqual({ kind: "preset", id: "lastMonth" });
    expect(parseRangeQuery("")).toEqual(DEFAULT_CHOICE);
    expect(parseRangeQuery("?from=2026-08-31&to=2026-08-01")).toEqual(DEFAULT_CHOICE); // end before start
    expect(parseRangeQuery("?from=2026-08-01")).toEqual(DEFAULT_CHOICE);
    expect(parseRangeQuery("?from=2026-02-30x&to=2026-03-01&period=last6Months")).toEqual({ kind: "preset", id: "last6Months" });
    expect(parseRangeQuery("?period=last2Years")).toEqual(DEFAULT_CHOICE);
  });
  it("still opens links saved before the standard picker", () => {
    expect(parseRangeQuery("?range=30d")).toEqual({ kind: "preset", id: "last30" });
    expect(parseRangeQuery("?range=3m")).toEqual({ kind: "preset", id: "last3Months" });
    expect(parseRangeQuery("?range=6m")).toEqual({ kind: "preset", id: "last6Months" });
    expect(parseRangeQuery("?range=12m")).toEqual({ kind: "preset", id: "last12Months" });
    expect(parseRangeQuery("?range=today")).toEqual({ kind: "preset", id: "today" });
    expect(parseRangeQuery("?range=yesterday")).toEqual({ kind: "preset", id: "yesterday" });
    expect(parseRangeQuery("?range=2y")).toEqual(DEFAULT_CHOICE);
  });
  it("never opens on Today & Yesterday, which this page can't show", () => {
    expect(UNAVAILABLE_PRESETS.todayAndYesterday).toBeTruthy();
    expect(parseRangeQuery("?period=todayAndYesterday")).toEqual(DEFAULT_CHOICE);
  });
  it("writes the same query back", () => {
    expect(rangeQuery({ kind: "custom", from: "2026-08-01", to: "2026-08-31" })).toBe("from=2026-08-01&to=2026-08-31");
    expect(rangeQuery({ kind: "preset", id: "last30" })).toBe("period=last30");
    const c = { kind: "custom" as const, from: "2026-05-04", to: "2026-06-19" };
    expect(parseRangeQuery(rangeQuery(c))).toEqual(c);
    const p = { kind: "preset" as const, id: "monthToDate" as const };
    expect(parseRangeQuery(rangeQuery(p))).toEqual(p);
  });
  it("gives the picker the days a choice covers", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    expect(choiceWindow({ kind: "preset", id: "lastMonth" }, now)).toMatchObject({ from: "2026-10-01", to: "2026-10-31", dayCount: 31 });
    expect(choiceWindow({ kind: "custom", from: "2026-11-02", to: "2026-11-08" }, now)).toMatchObject({ id: "custom", dayCount: 7 });
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
  it("names the comparison period", () => {
    expect(rangeDays("2026-08-01", "2026-08-31")).toBe(31);
    expect(previousRangeLabel({ kind: "range", pct: 100, previousPct: 90, changePts: 10, from: "2026-08-01", to: "2026-08-31", previousFrom: "2026-07-01", previousTo: "2026-07-31" }))
      .toBe("the 31 days before (1 Jul – 31 Jul)");
    expect(previousRangeLabel({ kind: "range", pct: 100, previousPct: null, changePts: null, from: "2026-08-03", to: "2026-08-03" })).toBe("the day before");
  });
});

describe("Today", () => {
  it("is kept in the URL as period=today", () => {
    expect(rangeQuery({ kind: "preset", id: "today" })).toBe("period=today");
  });
  it("fetches the last 30 stored days alongside the live estimate", () => {
    expect(reportQuery({ kind: "preset", id: "today" })).toBe("range=30d");
  });
  it("fetches every other period as its dates, like the KPIs tile", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    expect(reportQuery({ kind: "preset", id: "last6Months" }, now)).toBe("from=2026-05-24&to=2026-11-24");
    expect(reportQuery({ kind: "preset", id: "last7" }, now)).toBe("from=2026-11-18&to=2026-11-24");
    expect(reportQuery({ kind: "custom", from: "2026-08-01", to: "2026-08-31" }, now)).toBe("from=2026-08-01&to=2026-08-31");
  });
  it("offers Yesterday as the one London day before today", () => {
    const y = { kind: "preset" as const, id: "yesterday" as const };
    // 13 Nov, mid-afternoon → 12 Nov.
    expect(reportQuery(y, new Date("2026-11-13T15:00:00Z"))).toBe("from=2026-11-12&to=2026-11-12");
    // 00:30 BST on 1 Aug is still 31 Jul in UTC — London's day decides.
    expect(reportQuery(y, new Date("2026-07-31T23:30:00Z"))).toBe("from=2026-07-31&to=2026-07-31");
    // Across a month end.
    expect(reportQuery(y, new Date("2026-12-01T09:00:00Z"))).toBe("from=2026-11-30&to=2026-11-30");
  });
  it("never shows a misleading number before there is one", () => {
    expect(todayMessage("estimate")).toBeNull();
    expect(todayMessage("waiting_for_counts")).toMatch(/counted/);
    expect(todayMessage("no_labour")).toMatch(/clocked in/);
    expect(todayMessage("no_plan")).toMatch(/No production/);
  });
  it("says when it was worked out, in London time", () => {
    expect(asOfLabel("2026-09-25T15:17:59Z")).toBe("Updated 16:17");
    expect(asOfLabel("nonsense")).toBe("");
  });
});

describe("value ÷ labour and labour share, as percentages", () => {
  it("shows the ratio as a percentage: 5.64 is 564%", () => {
    expect(valueOnLabourPct(6335, 1123)).toBe("564%");
  });
  it("shows labour as a share of the value credited", () => {
    expect(labourShareOfValuePct(6335, 1123)).toBe("17.7%");
    expect(labourShareOfValuePct(1000, 150)).toBe("15.0%");
  });
  it("is a dash when there is no labour or no value yet", () => {
    expect(valueOnLabourPct(6660, 0)).toBe("—");
    expect(valueOnLabourPct(null, 100)).toBe("—");
    expect(labourShareOfValuePct(0, 100)).toBe("—");
    expect(labourShareOfValuePct(6660, null)).toBe("—");
  });
});
