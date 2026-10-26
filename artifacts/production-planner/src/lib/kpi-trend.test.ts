import { describe, it, expect } from "vitest";
import { kpiTrend, kpiWeekTrend, lastProductionDateLabel, rollingAverages, trendDayLabel } from "./kpi-trend";

describe("kpiTrend", () => {
  it("compares the last day with the average of the previous ones", () => {
    const t = kpiTrend([20, 20, 20, 20, 20, 20, 21.2], "higher")!;
    expect(t.direction).toBe("up");
    expect(t.tone).toBe("good");
    expect(Math.round(t.pct!)).toBe(6);
    expect(t.text).toBe("▲ 6% vs average of previous 6");
  });

  it("colours by the KPI's direction — fewer defects is good", () => {
    const t = kpiTrend([2, 2, 1], "lower")!;
    expect(t.direction).toBe("down");
    expect(t.tone).toBe("good");
    expect(t.text).toBe("▼ 50% vs average of previous 2");
    expect(kpiTrend([1, 1, 2], "lower")!.tone).toBe("bad");
  });

  it("a slower run rate is bad", () => {
    expect(kpiTrend([20, 22, 18], "higher")!.tone).toBe("bad");
  });

  it("neutral KPIs show the arrow but never good/bad", () => {
    const t = kpiTrend([80, 100], "neutral")!;
    expect(t.direction).toBe("up");
    expect(t.tone).toBe("neutral");
  });

  it("under 1% reads as level", () => {
    const t = kpiTrend([100, 100.5], "higher")!;
    expect(t.direction).toBe("flat");
    expect(t.tone).toBe("neutral");
    expect(t.text).toBe("● Level with average of previous 1");
  });

  it("skips days without a figure in the average", () => {
    const t = kpiTrend([10, null, 30, 30], "higher")!;
    expect(t.previousDays).toBe(2);
    expect(t.previousAverage).toBe(20);
  });

  it("from an average of zero it states the amount, not a percentage", () => {
    const t = kpiTrend([0, 0, 3], "lower", n => `${n}`)!;
    expect(t.pct).toBeNull();
    expect(t.text).toBe("▲ 3 vs average of previous 2");
    expect(t.tone).toBe("bad");
  });

  it("no trend without a last figure or anything to compare", () => {
    expect(kpiTrend([], "higher")).toBeNull();
    expect(kpiTrend([5], "higher")).toBeNull();
    expect(kpiTrend([5, null], "higher")).toBeNull();
    expect(kpiTrend([null, 5], "higher")).toBeNull();
  });
});

describe("lastProductionDateLabel", () => {
  it("says yesterday on a normal day", () => {
    expect(lastProductionDateLabel("2026-10-21", "2026-10-22")).toEqual({ date: "Wednesday 21 October", ago: "yesterday" });
  });

  it("says how many days back over a weekend", () => {
    expect(lastProductionDateLabel("2026-10-16", "2026-10-19")).toEqual({ date: "Friday 16 October", ago: "3 days ago" });
  });
});

describe("trendDayLabel", () => {
  it("is short weekday + day number", () => {
    expect(trendDayLabel("2026-10-16")).toBe("Fri 16");
  });
});

describe("weekly trend — 7-day average vs the 7 before (2026-10-26)", () => {
  const lastWeek = [16, 16, 17, 16, 17, 16, 17];   // avg 16.43
  const thisWeek = [20, 21, 22, 21, 22, 21, 21];   // avg 21.14
  it("compares the two weeks' averages, not yesterday alone", () => {
    const t = kpiWeekTrend([...lastWeek, ...thisWeek], "higher", n => n.toFixed(1))!;
    expect(t.direction).toBe("up");
    expect(t.tone).toBe("good");
    expect(Math.round(t.pct!)).toBe(29);
    expect(t.text).toBe("▲ 29% · 7-day avg 21.1 vs 16.4");
  });
  it("lower is better: wonkies falling reads good", () => {
    expect(kpiWeekTrend([20, 20, 20, 20, 20, 20, 20, 10, 10, 10, 10, 10, 10, 10], "lower")!.tone).toBe("good");
  });
  it("without two weeks of history it falls back to last day vs the days before", () => {
    expect(kpiWeekTrend([10, 10, 10, 10, 10, 10, 20], "higher")!.text).toBe("▲ 100% vs average of previous 6");
  });
  it("rolling averages smooth the line", () => {
    const r = rollingAverages([...lastWeek, ...thisWeek]);
    expect(r[13]).toBeCloseTo(21.14, 2);
    expect(r[6]).toBeCloseTo(16.43, 2);
    expect(rollingAverages([null, null, 5])).toEqual([null, null, null]);
  });
});
