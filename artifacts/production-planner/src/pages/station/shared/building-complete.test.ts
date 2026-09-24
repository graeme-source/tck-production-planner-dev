import { describe, it, expect } from "vitest";
import { isBuildingComplete, isItemBuilt, buildProgressPercent, stillToBuild, type BuildProgressItem } from "./building-complete";

const item = (target: number, built: number, markedComplete = false): BuildProgressItem => ({ target, built, markedComplete });

describe("isBuildingComplete", () => {
  // Regression: plan 172 (18 Sep 2026). Mac cheese built 16 of 14 packs —
  // 2 extra — while Philly was at 14 of 16 batches. The combined totals
  // matched (120/120) so the "That's everything built!" pop-up fired early.
  it("is NOT finished when extra mac cheese covers calzone batches still outstanding", () => {
    const items = [
      item(14, 16), // mac cheese, 2 extra packs
      item(11, 11), // other mac cheese
      item(16, 14), // Philly — 2 batches still to build
      item(13, 13),
      item(9, 9),
    ];
    expect(isBuildingComplete(items)).toBe(false);
  });

  it("is finished once the outstanding calzone item reaches its own target", () => {
    expect(isBuildingComplete([item(14, 16), item(16, 16)])).toBe(true);
  });

  it("never lets extras on one calzone cover another calzone's shortfall", () => {
    expect(isBuildingComplete([item(10, 12), item(8, 6)])).toBe(false);
  });

  it("counts an item the builder marked finished (a deliberate short build) as done", () => {
    expect(isBuildingComplete([item(8, 6, true), item(10, 10)])).toBe(true);
  });

  it("treats zero-target items as done, but a plan with nothing planned is not 'finished'", () => {
    expect(isBuildingComplete([item(0, 0), item(5, 5)])).toBe(true);
    expect(isBuildingComplete([item(0, 0)])).toBe(false);
    expect(isBuildingComplete([])).toBe(false);
  });
});

describe("isItemBuilt", () => {
  it("is built at or over target, or when marked finished", () => {
    expect(isItemBuilt(item(4, 3))).toBe(false);
    expect(isItemBuilt(item(4, 4))).toBe(true);
    expect(isItemBuilt(item(4, 6))).toBe(true);
    expect(isItemBuilt(item(4, 0, true))).toBe(true);
  });
});

describe("stillToBuild", () => {
  it("sums each item's own shortfall, ignoring extras elsewhere and finished items", () => {
    expect(stillToBuild([item(14, 16), item(16, 14)])).toBe(2);
    expect(stillToBuild([item(8, 6, true), item(10, 7)])).toBe(3);
  });
});

describe("buildProgressPercent", () => {
  it("caps each item at its own target so extras can't show 100% early", () => {
    // 16/14 mac + 14/16 Philly: capped done = 14 + 14 = 28 of 30.
    expect(buildProgressPercent([item(14, 16), item(16, 14)])).toBe(93);
  });

  it("reaches 100% only when every item is complete", () => {
    expect(buildProgressPercent([item(14, 16), item(16, 16)])).toBe(100);
    expect(buildProgressPercent([item(8, 6, true), item(10, 10)])).toBe(100);
  });

  it("is 0 with nothing planned", () => {
    expect(buildProgressPercent([])).toBe(0);
  });
});
