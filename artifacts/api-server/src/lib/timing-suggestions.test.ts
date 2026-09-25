import { describe, it, expect } from "vitest";
import {
  median, robustMedian, buildGapsByRecipe, suggestBuildSeconds, suggestCookMinutes,
  type BuildCompletion,
} from "./timing-suggestions";

const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 24, 6, 0);

/** A stream of completions for one plan item on one station, `gapsMin` apart. */
function stream(recipeId: number, planItemId: number, stationType: string, gapsMin: number[], planId = 1): BuildCompletion[] {
  let t = T0;
  const out: BuildCompletion[] = [{ recipeId, planId, planItemId, stationType, completedAtMs: t }];
  for (const g of gapsMin) {
    t += g * MIN;
    out.push({ recipeId, planId, planItemId, stationType, completedAtMs: t });
  }
  return out;
}

describe("median / robustMedian", () => {
  it("median of odd and even lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it("drops values over 3× the median", () => {
    expect(robustMedian([5, 5, 5, 5, 5, 60], 3, 5)).toEqual({ value: 5, kept: 5, dropped: 1 });
  });
  it("refuses to suggest from too little evidence", () => {
    expect(robustMedian([5, 5, 5, 5], 3, 5)).toBeNull();
    expect(robustMedian([], 3, 5)).toBeNull();
  });
});

describe("suggestBuildSeconds — per-builder seconds per batch from completion gaps", () => {
  it("takes the median gap within each (plan item, station) stream", () => {
    const rows = [
      ...stream(26, 100, "building_1", [5, 5, 5, 5, 5, 5]),
      ...stream(26, 100, "building_2", [5.5, 5.5, 5.5]),
    ];
    const s = suggestBuildSeconds(rows).get(26)!;
    expect(s.value).toBe(300);
    expect(s.samples).toBe(9);
    expect(s.excluded).toBe(0);
  });

  it("never measures a gap across two different streams", () => {
    // Two streams far apart in time — if they were joined, one huge gap would appear.
    const rows = [
      ...stream(5, 1, "building_1", [6, 6, 6]),
      ...stream(5, 2, "building_1", [6, 6, 6]),
    ];
    const g = buildGapsByRecipe(rows).get(5)!;
    expect(g.gaps).toHaveLength(6);
  });

  it("drops double-taps, gaps over 25 min, and 3× outliers", () => {
    const rows = stream(7, 1, "building_1", [0.1, 5, 5, 5, 5, 5, 16, 40]);
    const s = suggestBuildSeconds(rows).get(7)!;
    // 0.1 min (6 s) = double-tap; 40 min > 25-min cap; 16 min > 3 × 5 min.
    expect(s.value).toBe(300);
    expect(s.samples).toBe(5);
    expect(s.excluded).toBe(3);
  });

  it("drops a gap that has a logged station break inside it", () => {
    const rows = stream(8, 1, "building_1", [5, 5, 5, 5, 5, 20]);
    const breakStart = T0 + 26 * MIN; // inside the 25→45 min gap
    const withBreak = suggestBuildSeconds(rows, [
      { planId: 1, stationType: "building_1", startMs: breakStart, endMs: breakStart + 15 * MIN },
    ]).get(8)!;
    expect(withBreak.samples).toBe(5);
    expect(withBreak.excluded).toBe(1);
    // A break on the OTHER station doesn't disqualify this builder's gap —
    // the 20-min gap then goes to the outlier rule instead (> 3 × 5).
    const otherStation = suggestBuildSeconds(rows, [
      { planId: 1, stationType: "building_2", startMs: breakStart, endMs: breakStart + 15 * MIN },
    ]).get(8)!;
    expect(otherStation.samples).toBe(5);
  });

  it("a never-ended break disqualifies only the gap it started in", () => {
    const rows = stream(8, 1, "building_1", [5, 5, 10, 5, 5, 5, 5]);
    const s = suggestBuildSeconds(rows, [
      { planId: 1, stationType: "building_1", startMs: T0 + 11 * MIN, endMs: null },
    ]).get(8)!;
    // Only the 10→20 min gap goes; the five 5-min gaps after it all count.
    expect(s.samples).toBe(6);
    expect(s.excluded).toBe(1);
  });

  it("no suggestion under 5 usable batches", () => {
    expect(suggestBuildSeconds(stream(9, 1, "building_1", [5, 5, 5, 5])).has(9)).toBe(false);
  });
});

describe("suggestCookMinutes — oven-in to oven-out", () => {
  it("ignores tap-throughs under 3 min and long outliers", () => {
    const s = suggestCookMinutes([0, 0.1, 0.2, 16, 17, 16, 18, 15, 200]);
    expect(s).toEqual({ value: 16, samples: 5, excluded: 4 });
  });
  it("no suggestion when nearly every tray was a tap-through", () => {
    // Chicken thighs 2026-08/09: 14 trays, every one logged in and out at once.
    expect(suggestCookMinutes(Array(14).fill(0.1))).toBeNull();
  });
});
