import { describe, expect, it } from "vitest";
import {
  benchmarkDays, benchmarkProblem, dayForecast, formatBenchmark, gradeKpi, kpiSpec, londonHoursGone, shareOfDayDone, type Benchmark,
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
