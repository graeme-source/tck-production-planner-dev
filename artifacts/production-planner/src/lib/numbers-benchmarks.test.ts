import { describe, expect, it } from "vitest";
import {
  benchmarkDays, benchmarkProblem, dayForecast, formatBenchmark, gradeKpi, kpiSpec, londonHoursGone, monthlyFromDaily, dailyFromMonthly, salesBenchmark, shareOfDayDone, type Benchmark,
} from "./numbers-benchmarks";
import { shadeAtRatio } from "./ad-efficiency";

const sales = kpiSpec("sales");
const aov = kpiSpec("aov");
const adSpend = kpiSpec("adSpend");
const ncr = kpiSpec("newCustomerRevenue");
const b: Benchmark = { minimum: 1500, stretch: 2000 };

describe("gradeKpi", () => {
  it("colours like a ROAS card under the minimum", () => {
    expect(gradeKpi(1425, b, ncr)?.shade.hex).toBe(shadeAtRatio(0.95).hex);
    expect(gradeKpi(1275, b, ncr)?.shade.hex).toBe(shadeAtRatio(0.85).hex);
    expect(gradeKpi(100, b, ncr)?.shade.step).toBe(0);
  });

  it("is green at the minimum, darker at the stretch, and darkest past it", () => {
    expect(gradeKpi(1500, b, ncr)?.shade.hex).toBe(shadeAtRatio(1).hex);
    expect(gradeKpi(2000, b, ncr)?.shade.hex).toBe(shadeAtRatio(1.25).hex);
    expect(gradeKpi(2500, b, ncr)?.shade.step).toBe(30);
  });

  it("scales a per-day benchmark to the period, but not a rate", () => {
    expect(gradeKpi(10_500, b, sales, 7)?.levels).toEqual({ minimum: 10_500, stretch: 14_000 });
    expect(gradeKpi(50, { minimum: 40, stretch: 55 }, aov, 7)?.levels).toEqual({ minimum: 40, stretch: 55 });
  });

  it("reads £1,000 by midday as ahead when most of a day comes later", () => {
    const usualShare = 0.4;
    expect(gradeKpi(1000, b, ncr, usualShare)?.shade.step).toBe(30);
    expect(dayForecast(1000, usualShare)).toBe(2500);
  });

  it("runs the other way when less is better", () => {
    const spend: Benchmark = { minimum: 500, stretch: 300 };
    expect(gradeKpi(500, spend, adSpend)?.shade.hex).toBe(shadeAtRatio(1).hex);
    expect(gradeKpi(600, spend, adSpend)!.shade.step).toBeLessThan(gradeKpi(500, spend, adSpend)!.shade.step);
    expect(gradeKpi(0, spend, adSpend)?.shade.step).toBe(30);
  });

  it("stays quiet with no figure, half a benchmark or figures the wrong way round", () => {
    expect(gradeKpi(null, b, ncr)).toBeNull();
    expect(gradeKpi(100, { minimum: 100, stretch: null }, ncr)).toBeNull();
    expect(gradeKpi(100, { minimum: 200, stretch: 100 }, ncr)).toBeNull();
    expect(gradeKpi(100, b, ncr, 0)).toBeNull();
  });
});

describe("one sales target, daily or monthly", () => {
  it("works out the day from the month, and the month from the day", () => {
    expect(salesBenchmark(120_000, 180_000, 30)).toEqual({ minimum: 4000, stretch: 6000 });
    expect(dailyFromMonthly(120_000, 30)).toBe(4000);
    expect(monthlyFromDaily(4500, 30)).toBe(135_000);
  });

  it("comes back to the same month after a round trip", () => {
    expect(monthlyFromDaily(dailyFromMonthly(125_000, 31), 31)).toBe(125_000);
  });

  it("has Average Daily, Month to Date and Forecast agree", () => {
    const daily = salesBenchmark(120_000, 180_000, 30);
    const shade = gradeKpi(116_005.74, { minimum: 120_000, stretch: 180_000 }, kpiSpec("monthlySales"))?.shade.hex;
    expect(gradeKpi(116_005.74 / 30, daily, sales, 1)?.shade.hex).toBe(shade);
  });
});

describe("the month's revenue", () => {
  const month = kpiSpec("monthlySales");
  const targets: Benchmark = { minimum: 120_000, stretch: 180_000 };

  it("isn't scaled: it's judged on where the month is heading", () => {
    expect(gradeKpi(116_006, targets, month, 5)?.levels).toEqual(targets);
  });

  it("is under the minimum when it's heading short, however it reads today", () => {
    expect(gradeKpi(116_006, targets, month)?.shade.hex).toBe(shadeAtRatio(116_006 / 120_000).hex);
    expect(gradeKpi(116_006, targets, month)!.shade.step).toBeLessThan(gradeKpi(120_000, targets, month)!.shade.step);
  });

  it("has no colour without a stretch for the month", () => {
    expect(gradeKpi(100, { minimum: 120_000, stretch: null }, month)).toBeNull();
  });
});

describe("benchmarkProblem", () => {
  it("says what's missing or the wrong way round", () => {
    expect(benchmarkProblem({ minimum: null, stretch: null }, aov)).toBeNull();
    expect(benchmarkProblem({ minimum: 1, stretch: null }, aov)).toContain("both");
    expect(benchmarkProblem({ minimum: 3, stretch: 2 }, aov)).toContain("above");
    expect(benchmarkProblem({ minimum: 2, stretch: 3 }, adSpend)).toContain("below");
    expect(benchmarkProblem(b, aov)).toBeNull();
  });
});

describe("the running day", () => {
  const curve = Array.from({ length: 24 }, (_, h) => (h < 12 ? 0.02 * (h + 1) : 0.24 + (0.76 * (h - 11)) / 12));

  it("uses the usual pattern, part way through the hour", () => {
    expect(shareOfDayDone(curve, 11.5)).toBeCloseTo(0.23);
  });

  it("falls back on the clock with no history", () => {
    expect(shareOfDayDone(undefined, 12)).toBe(0.5);
  });

  it("counts today as the usual share, and finished periods in full", () => {
    expect(benchmarkDays({ dayCount: 5, includesToday: true }, 0.4)).toBeCloseTo(4.4);
    expect(benchmarkDays({ dayCount: 7, includesToday: false }, 0.4)).toBe(7);
  });

  it("won't judge a day that's barely begun", () => {
    expect(benchmarkDays({ dayCount: 1, includesToday: true }, 0.02)).toBeNull();
    expect(dayForecast(100, 0.02)).toBeNull();
    expect(benchmarkDays({ dayCount: 5, includesToday: true }, 0.02)).toBeCloseTo(4.02);
  });
});

it("reads the time of day in London", () => {
  expect(londonHoursGone(new Date("2026-07-01T11:30:00Z"))).toBe(12.5);
  expect(londonHoursGone(new Date("2026-11-05T12:00:00Z"))).toBe(12);
});

it("formats each unit", () => {
  expect(formatBenchmark(1234.6, "£")).toBe("£1,235");
  expect(formatBenchmark(2.456, "%")).toBe("2.5%");
  expect(formatBenchmark(3.25, "count")).toBe("3.3");
});
