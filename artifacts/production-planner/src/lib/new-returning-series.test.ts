import { describe, expect, it } from "vitest";
import {
  AXIS_STEPS,
  countAxis,
  DEFAULT_SPLIT_VISIBILITY,
  isLastOn,
  niceAxis,
  parseSplitVisibility,
  percentAxis,
  toggleSplitSeries,
} from "./new-returning-series";
import { chartPoints, type ChartPoint, type TrendBucket, type TrendFigures, type TrendSeries } from "./sales-trend-view";

const zero: TrendFigures = {
  revenue: 0, orders: 0, paidOrders: 0, aov: null, newCustomerRevenue: 0, newCustomerOrders: 0,
  newCustomerPaidOrders: 0, returningOrders: 0, newCustomerSharePercent: null, newCustomerRevenueSharePercent: null,
  recurringSubOrders: 0, newSubOrders: 0, subscriptionRevenue: 0, subscriptionOrders: 0,
  adSpend: null, spendDaysRecorded: 0, spendDays: 0, roasPercent: null,
};

function day(n: number, over: Partial<TrendBucket> = {}): TrendBucket {
  return {
    ...zero, key: `d${n}`, start: "", end: "", label: `${n} Oct`, longLabel: `${n} Oct`,
    hourOfDay: null, dayCount: 1, future: false, running: false, partial: false, ...over,
  };
}

function series(buckets: TrendBucket[], granularity: TrendSeries["granularity"] = "day"): TrendSeries {
  return { from: "2026-10-01", to: "2026-10-07", granularity, allowed: ["day", "week"], buckets, totals: zero, outsideOrders: 0 };
}

function split(n: number, newOrders: number, returning: number, over: Partial<TrendBucket> = {}): TrendBucket {
  const paid = newOrders + returning;
  return day(n, {
    paidOrders: paid, orders: paid, newCustomerPaidOrders: newOrders, returningOrders: returning,
    newCustomerSharePercent: paid > 0 ? (newOrders / paid) * 100 : null, ...over,
  });
}

describe("new vs returning lines on the share graph", () => {
  it("the % can fall while new orders rise — both are drawn from the same buckets", () => {
    const pts = chartPoints(series([split(1, 10, 30), split(2, 14, 86)]), "newCustomerShare");
    expect(pts.map(p => Math.round(p.value ?? -1))).toEqual([25, 14]);
    expect(pts.map(p => p.newLine)).toEqual([10, 14]);
    expect(pts.map(p => p.returningLine)).toEqual([30, 86]);
  });

  it("a day with no paid orders: % gap as today, counts are a real 0; days to come have no lines", () => {
    const pts = chartPoints(series([split(1, 5, 5), day(2), day(3, { future: true })]), "newCustomerShare");
    expect(pts.map(p => p.value)).toEqual([50, null, null]);
    expect(pts.map(p => p.newLine)).toEqual([5, 0, null]);
    expect(pts.map(p => p.returningLine)).toEqual([5, 0, null]);
  });

  it("weekly buckets carry the week's counts", () => {
    const pts = chartPoints(series([split(1, 70, 210, { partial: true }), split(8, 90, 260)], "week"), "newCustomerShare");
    expect(pts.map(p => [p.newLine, p.returningLine])).toEqual([[70, 210], [90, 260]]);
  });
});

describe("which lines are on", () => {
  it("all three on by default", () => {
    expect(DEFAULT_SPLIT_VISIBILITY).toEqual({ share: true, new: true, returning: true });
  });

  it("toggles one line at a time", () => {
    const v = toggleSplitSeries(DEFAULT_SPLIT_VISIBILITY, "returning");
    expect(v).toEqual({ share: true, new: true, returning: false });
    expect(toggleSplitSeries(v, "returning")).toEqual(DEFAULT_SPLIT_VISIBILITY);
  });

  it("the last line on can't be switched off", () => {
    const onlyNew = { share: false, new: true, returning: false };
    expect(isLastOn(onlyNew, "new")).toBe(true);
    expect(isLastOn(onlyNew, "share")).toBe(false);
    expect(toggleSplitSeries(onlyNew, "new")).toBe(onlyNew);
    expect(toggleSplitSeries(onlyNew, "share")).toEqual({ share: true, new: true, returning: false });
  });

  it("reads a remembered choice back, falling back to all on when it's missing, broken or all off", () => {
    expect(parseSplitVisibility(JSON.stringify({ share: false, new: true, returning: true })))
      .toEqual({ share: false, new: true, returning: true });
    expect(parseSplitVisibility(null)).toEqual(DEFAULT_SPLIT_VISIBILITY);
    expect(parseSplitVisibility("{not json")).toEqual(DEFAULT_SPLIT_VISIBILITY);
    expect(parseSplitVisibility("42")).toEqual(DEFAULT_SPLIT_VISIBILITY);
    expect(parseSplitVisibility(JSON.stringify({ share: false, new: false, returning: false }))).toEqual(DEFAULT_SPLIT_VISIBILITY);
    expect(parseSplitVisibility(JSON.stringify({ share: false }))).toEqual({ share: false, new: true, returning: true });
  });
});

describe("axes", () => {
  it("every axis has the same number of equal steps from 0, so gridlines line up", () => {
    for (const max of [0, 3, 7, 41, 86, 99, 100, 260, 1234]) {
      const a = niceAxis(max);
      expect(a.ticks).toHaveLength(AXIS_STEPS + 1);
      expect(a.ticks[0]).toBe(0);
      expect(a.max).toBeGreaterThanOrEqual(max);
      expect(a.ticks.every(t => Number.isInteger(t))).toBe(true);
    }
  });

  it("picks a snug, readable top", () => {
    expect(niceAxis(86).ticks).toEqual([0, 25, 50, 75, 100]);
    expect(niceAxis(41).ticks).toEqual([0, 15, 30, 45, 60]);
    expect(niceAxis(7).ticks).toEqual([0, 2, 4, 6, 8]);
    expect(niceAxis(3).ticks).toEqual([0, 1, 2, 3, 4]);
    expect(niceAxis(0).ticks).toEqual([0, 1, 2, 3, 4]);
    expect(niceAxis(260).ticks).toEqual([0, 80, 160, 240, 320]);
  });

  it("the % axis never tops 100% and is 0–100% with no % yet", () => {
    const pts = (vals: Array<number | null>) => vals.map(v => ({ value: v }) as ChartPoint);
    expect(percentAxis(pts([25, 100])).max).toBe(100);
    expect(percentAxis(pts([12, 34, null])).ticks).toEqual([0, 10, 20, 30, 40]);
    expect(percentAxis(pts([null])).max).toBe(100);
  });

  it("the orders axis scales to the count lines that are on", () => {
    const pts = chartPoints(series([split(1, 10, 30), split(2, 14, 86), day(3, { future: true })]), "newCustomerShare");
    expect(countAxis(pts, DEFAULT_SPLIT_VISIBILITY)?.max).toBe(100);
    expect(countAxis(pts, { share: true, new: true, returning: false })?.ticks).toEqual([0, 4, 8, 12, 16]);
    expect(countAxis(pts, { share: true, new: false, returning: false })).toBeNull();
  });
});
