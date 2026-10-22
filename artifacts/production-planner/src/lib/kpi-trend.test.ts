import { describe, it, expect } from "vitest";
import { kpiTrend, lastProductionDateLabel, trendDayLabel } from "./kpi-trend";

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
