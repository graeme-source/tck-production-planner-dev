import { describe, expect, it } from "vitest";
import { axisValues, niceStep, trendAxis, trendBand, trendChange, trendPoints, type TrendBands } from "./kpi-trend-bands";

const packing: TrendBands = { stretch: 60, standard: 50, close: 45 };

describe("KPI trend — bands", () => {
  it("colours a day against its targets, higher is better", () => {
    expect(trendBand(62, packing)).toBe("platinum");
    expect(trendBand(50, packing)).toBe("green");
    expect(trendBand(46, packing)).toBe("amber");
    expect(trendBand(30, packing)).toBe("red");
    expect(trendBand(null, packing)).toBe("neutral");
  });
  it("no yellow band: under the standard is red; no targets: neutral", () => {
    expect(trendBand(95, { stretch: 110, standard: 90, close: null })).toBe("green");
    expect(trendBand(85, { stretch: 110, standard: 90, close: null })).toBe("red");
    expect(trendBand(3.2, null)).toBe("neutral");
  });
});

describe("KPI trend — points", () => {
  // Regression (Graeme, 17 Nov 2026): the room's days came newest first in a
  // three-column grid and couldn't be read as a trend.
  it("puts days oldest first and averages the last 7 days with a figure", () => {
    const rows = ["2026-11-10", "2026-11-03", "2026-11-04", "2026-11-05"].map((date, i) => ({ date, value: [100, 80, 90, null][i] }));
    const p = trendPoints(rows, null);
    expect(p.map(x => x.date)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-10"]);
    expect(p.map(x => x.rolling)).toEqual([80, 85, 85, 90]);
    expect(p[2].value).toBeNull();
  });
  it("keeps only the last 7 figures in the average", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ date: `2026-11-0${i + 1}`, value: i < 2 ? 0 : 10 }));
    expect(trendPoints(rows, null).at(-1)!.rolling).toBe(10);
  });
  it("says how far the average moved over the range", () => {
    const p = trendPoints([{ date: "2026-11-01", value: 40 }, { date: "2026-11-02", value: 60 }], packing);
    expect(trendChange(p)).toBe(10);
  });
});

describe("KPI trend — axis", () => {
  it("uses tidy steps", () => {
    expect(niceStep(23)).toBe(5);
    expect(niceStep(1.2)).toBe(0.25);
    expect(niceStep(0)).toBe(1);
  });
  it("keeps every figure and target line in view, never below 0", () => {
    const p = trendPoints([{ date: "2026-11-01", value: 41 }, { date: "2026-11-02", value: 63 }], packing);
    const a = trendAxis(p, packing);
    expect(a.lo).toBeLessThanOrEqual(41);
    expect(a.hi).toBeGreaterThanOrEqual(63);
    expect(a.lo).toBeGreaterThanOrEqual(0);
    expect(a.ticks[0]).toBe(a.lo);
    expect(a.ticks.at(-1)).toBe(a.hi);
  });
});

describe("KPI trend — freak days", () => {
  // Regression (17 Nov 2026): one wrapping day logged at ~400 packs an hour
  // stretched the axis to 0–400 and flattened every normal day.
  it("leaves a freak day off the axis range, and says so", () => {
    const rows = [110, 112, 108, 115, 120, 105, 118, 400].map((value, i) => ({ date: `2026-11-0${i + 1}`, value }));
    const p = trendPoints(rows, { stretch: 135, standard: 115, close: 103.5 });
    const a = trendAxis(p, { stretch: 135, standard: 115, close: 103.5 });
    expect(a.capped).toBe(true);
    expect(a.hi).toBeLessThan(400);
    expect(a.hi).toBeGreaterThanOrEqual(135);
  });
  it("keeps everything when nothing is far out", () => {
    expect(axisValues([10, 11, 12, 13, 14, 15]).cap).toBeNull();
    expect(axisValues([10, 400]).cap).toBeNull();
  });
});
