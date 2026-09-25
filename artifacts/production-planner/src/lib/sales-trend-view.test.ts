import { describe, expect, it } from "vitest";
import {
  chartPoints,
  formatAxis,
  formatMetric,
  headlineNote,
  unavailableReason,
  type TrendBucket,
  type TrendFigures,
  type TrendSeries,
} from "./sales-trend-view";

const zero: TrendFigures = {
  revenue: 0, orders: 0, aov: null, newCustomerRevenue: 0, newCustomerOrders: 0,
  recurringSubOrders: 0, newSubOrders: 0, subscriptionRevenue: 0, subscriptionOrders: 0,
  adSpend: null, spendDaysRecorded: 0, spendDays: 0, roasPercent: null,
};

function bucket(hour: number, over: Partial<TrendBucket> = {}): TrendBucket {
  return {
    ...zero, key: `h${hour}`, start: "", end: "", label: `${hour}:00`, longLabel: `${hour}:00`,
    hourOfDay: hour, dayCount: 0, future: false, partial: false, ...over,
  };
}

function series(buckets: TrendBucket[], totals: Partial<TrendFigures> = {}, granularity: TrendSeries["granularity"] = "hour"): TrendSeries {
  return { from: "2026-09-25", to: "2026-09-25", granularity, allowed: [granularity], buckets, totals: { ...zero, ...totals }, outsideOrders: 0 };
}

describe("chartPoints", () => {
  it("stops the line at now: future buckets have no value", () => {
    const s = series([bucket(9, { revenue: 50 }), bucket(10, { revenue: 20, partial: true }), bucket(11, { future: true })]);
    const pts = chartPoints(s, "revenue");
    expect(pts.map(p => p.value)).toEqual([50, 20, null]);
    expect(pts[1].partial).toBe(true);
    expect(pts[2].partial).toBe(false);
  });

  it("an hour with no orders has no AOV point (a gap, not £0)", () => {
    const s = series([bucket(3), bucket(4, { revenue: 90, orders: 2, aov: 45 })]);
    expect(chartPoints(s, "aov").map(p => p.value)).toEqual([null, 45]);
  });

  it("lines last week up by hour of day, even across a clock change", () => {
    const today = series([bucket(0, { revenue: 5 }), bucket(2, { revenue: 7 }), bucket(3, { revenue: 9, future: true })]);
    // Last week's day had an extra hour (25-hour day): two 01:00s.
    const lastWeek = series([bucket(0, { revenue: 1 }), bucket(1, { revenue: 2 }), bucket(1, { revenue: 3 }), bucket(2, { revenue: 4 }), bucket(3, { revenue: 6 })]);
    const pts = chartPoints(today, "revenue", lastWeek);
    expect(pts.map(p => p.compare)).toEqual([1, 4, 6]);
    expect(pts.map(p => p.value)).toEqual([5, 7, null]);
  });
});

describe("headlines and reasons", () => {
  it("AOV note shows the weighted sum it comes from", () => {
    expect(headlineNote(series([], { revenue: 100, orders: 4, aov: 25 }), "aov")).toMatch(/£100\.00 ÷ 4 orders/);
  });
  it("only mentions the dashed line when a graph is drawn", () => {
    const totals = { newCustomerRevenue: 300, adSpend: 100, roasPercent: 300, spendDays: 1, spendDaysRecorded: 1 };
    expect(headlineNote(series([], totals, "day"), "roas")).toMatch(/dashed line/);
    expect(headlineNote(series([], totals, "hour"), "roas")).not.toMatch(/dashed line/);
  });
  it("ROAS says what it's waiting for instead of 0%", () => {
    expect(headlineNote(series([], { spendDays: 7, spendDaysRecorded: 5 }), "roas")).toBe("Waiting on 2 days of spend");
  });
  it("spend-based graphs can't be drawn by the hour", () => {
    expect(unavailableReason(series([], {}, "hour"), "roas")).toMatch(/per day/);
    expect(unavailableReason(series([], {}, "day"), "roas")).toBeNull();
    expect(unavailableReason(series([], {}, "hour"), "revenue")).toBeNull();
  });
});

describe("formatting", () => {
  it("prints unknown as a dash, never £0", () => {
    expect(formatMetric("money", null)).toBe("—");
    expect(formatMetric("money", 1234.5)).toBe("£1,234.50");
    expect(formatMetric("percent", 203.4)).toBe("203%");
    expect(formatMetric("count", 84)).toBe("84");
  });
  it("keeps axis ticks short", () => {
    expect(formatAxis("money", 1500)).toBe("£1.5k");
    expect(formatAxis("money", 1050)).toBe("£1.05k");
    expect(formatAxis("money", 2000)).toBe("£2k");
    expect(formatAxis("money", 350)).toBe("£350");
    expect(formatAxis("count", 2.5)).toBe("");
  });
});
