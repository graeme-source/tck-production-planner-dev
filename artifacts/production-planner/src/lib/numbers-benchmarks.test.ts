import { describe, expect, it } from "vitest";
import {
  benchmarkDays, benchmarkProblem, comparisonWindow, formatBenchmark, gradeKpi, kpiChange, kpiSpec, londonDayFraction, priorAtThisTime, type Benchmark,
} from "./numbers-benchmarks";
import { shadeAtRatio } from "./ad-efficiency";
import type { TrendBucket, TrendFigures } from "./sales-trend-view";

const sales = kpiSpec("sales");
const aov = kpiSpec("aov");
const adSpend = kpiSpec("adSpend");
const b: Benchmark = { minimum: 100, good: 120, veryGood: 150 };
const spend: Benchmark = { minimum: 500, good: 400, veryGood: 300 };

describe("gradeKpi", () => {
  it("gives the four grades", () => {
    expect(gradeKpi(90, b, aov)?.word).toBe("Under");
    expect(gradeKpi(100, b, aov)?.word).toBe("Minimum");
    expect(gradeKpi(120, b, aov)?.word).toBe("Good");
    expect(gradeKpi(150, b, aov)?.word).toBe("Very good");
  });

  it("uses the Advertising Efficiency colours: green at good, yellow at minimum", () => {
    expect(gradeKpi(120, b, aov)?.shade.hex).toBe(shadeAtRatio(1).hex);
    expect(gradeKpi(100, b, aov)?.shade.hex).toBe(shadeAtRatio(0.95).hex);
    expect(gradeKpi(1, b, aov)?.shade.step).toBe(0);
    expect(gradeKpi(10_000, b, aov)?.shade.step).toBe(30);
  });

  it("scales a per-day benchmark to the period, but not a rate", () => {
    expect(gradeKpi(2_100, b, sales, 7)?.levels.veryGood).toBe(1050);
    expect(gradeKpi(2_100, b, sales, 7)?.word).toBe("Very good");
    expect(gradeKpi(110, b, aov, 7)?.word).toBe("Minimum");
  });

  it("judges a running day on the part gone", () => {
    expect(gradeKpi(60, b, sales, benchmarkDays({ dayCount: 1, includesToday: true }, 0.5))?.word).toBe("Good");
  });

  it("runs downwards when less is better", () => {
    expect(gradeKpi(600, spend, adSpend)?.word).toBe("Under");
    expect(gradeKpi(450, spend, adSpend)?.word).toBe("Minimum");
    expect(gradeKpi(350, spend, adSpend)?.word).toBe("Good");
    expect(gradeKpi(0, spend, adSpend)?.word).toBe("Very good");
  });

  it("stays quiet with no figure or an unfinished set", () => {
    expect(gradeKpi(null, b, aov)).toBeNull();
    expect(gradeKpi(100, { ...b, good: null }, aov)).toBeNull();
    expect(gradeKpi(100, { minimum: 150, good: 120, veryGood: 100 }, aov)).toBeNull();
  });
});

describe("benchmarkProblem", () => {
  it("says what's missing or out of order", () => {
    expect(benchmarkProblem({ minimum: null, good: null, veryGood: null }, aov)).toBeNull();
    expect(benchmarkProblem({ ...b, good: null }, aov)).toContain("all three");
    expect(benchmarkProblem({ minimum: 3, good: 2, veryGood: 1 }, aov)).toContain("up from left");
    expect(benchmarkProblem(b, adSpend)).toContain("down from left");
    expect(benchmarkProblem(spend, adSpend)).toBeNull();
  });
});

describe("comparisonWindow", () => {
  const win = (id: string, from: string, to: string, dayCount: number, includesToday = false) => ({ id, from, to, dayCount, includesToday });

  it("compares a single day with the same weekday last week", () => {
    expect(comparisonWindow(win("yesterday", "2026-11-04", "2026-11-04", 1))).toMatchObject({ from: "2026-10-28", to: "2026-10-28", cutLastDay: false });
    expect(comparisonWindow(win("today", "2026-11-05", "2026-11-05", 1, true)).cutLastDay).toBe(true);
  });

  it("compares month to date with the same point last month", () => {
    expect(comparisonWindow(win("monthToDate", "2026-11-01", "2026-11-05", 5, true))).toMatchObject({ from: "2026-10-01", to: "2026-10-05", cutLastDay: true });
    expect(comparisonWindow(win("monthToDate", "2026-03-01", "2026-03-31", 31, true)).to).toBe("2026-02-28");
  });

  it("compares last month with the month before", () => {
    expect(comparisonWindow(win("lastMonth", "2026-10-01", "2026-10-31", 31))).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("compares anything else with the same days just before", () => {
    expect(comparisonWindow(win("last7", "2026-10-29", "2026-11-04", 7))).toMatchObject({ from: "2026-10-22", to: "2026-10-28" });
  });
});

describe("priorAtThisTime", () => {
  const figures = (over: Partial<TrendFigures>) => ({ revenue: 0, orders: 0, paidOrders: 0, newCustomerRevenue: 0, newCustomerOrders: 0, newCustomerPaidOrders: 0, recurringSubOrders: 0, newSubOrders: 0, subscriptionRevenue: 0, ...over }) as TrendFigures;
  const hours = [
    { ...figures({ revenue: 100, paidOrders: 2 }), hourOfDay: 9 },
    { ...figures({ revenue: 100, paidOrders: 2 }), hourOfDay: 10 },
    { ...figures({ revenue: 100, paidOrders: 2 }), hourOfDay: 11 },
  ] as TrendBucket[];

  it("counts the hours gone and the running hour pro rata", () => {
    expect(priorAtThisTime(null, hours, 10.5 / 24).revenue).toBe(150);
  });

  it("adds the whole days before, and works AOV from the totals", () => {
    const p = priorAtThisTime(figures({ revenue: 1000, paidOrders: 10 }), hours, 12 / 24);
    expect(p.revenue).toBe(1300);
    expect(p.aov).toBe(1300 / 16);
  });

  it("gives no ad spend comparison, which is only known by the day", () => {
    expect(priorAtThisTime(null, hours, 0.5).adSpend).toBeNull();
    expect(priorAtThisTime(null, hours, 0.5).newCustomerRoas).toBeNull();
  });
});

describe("kpiChange", () => {
  it("says whether it's improving", () => {
    expect(kpiChange(110, 100, sales)).toEqual({ direction: "up", percent: 10, better: true });
    expect(kpiChange(90, 100, sales)).toEqual({ direction: "down", percent: 10, better: false });
  });

  it("treats less spend as better", () => {
    expect(kpiChange(90, 100, adSpend)).toEqual({ direction: "down", percent: 10, better: true });
  });

  it("calls a wobble level, and won't compare with nothing", () => {
    expect(kpiChange(100.5, 100, sales)?.direction).toBe("flat");
    expect(kpiChange(100, 0, sales)).toBeNull();
    expect(kpiChange(100, null, sales)).toBeNull();
  });
});

it("reads the time of day in London", () => {
  expect(londonDayFraction(new Date("2026-07-01T11:00:00Z"))).toBe(0.5);
  expect(londonDayFraction(new Date("2026-11-05T12:00:00Z"))).toBe(0.5);
});

it("formats each unit", () => {
  expect(formatBenchmark(1234.6, "£")).toBe("£1,235");
  expect(formatBenchmark(2.456, "%")).toBe("2.5%");
  expect(formatBenchmark(3.25, "count")).toBe("3.3");
});
