import { describe, it, expect } from "vitest";
import { deriveDoughMixStatus, applyDoughMixChange, type SavedDoughMix } from "./dough-mix-status";

const done = (s: Set<number>) => [...s].sort((a, b) => a - b);

// Regression (Graeme, 2026-10-12): on live all 110 balls were recorded
// 09:04–10:05, but mix ticks lived only in memory, so the Dough Prep page
// said "0 of 2 mixes done" and Graeme thought the dough wasn't finished.
describe("dough mix status — nothing saved, read from the balls", () => {
  it("all balls recorded → every mix done, 'Mixed — balls all recorded'", () => {
    const s = deriveDoughMixStatus({ mixCount: 2, saved: [], ballsRecorded: 110, ballsNeeded: 110 });
    expect(done(s.completedMixes)).toEqual([1, 2]);
    expect(done(s.estimatedMixes)).toEqual([1, 2]);
    expect(s.note).toBe("Mixed — balls all recorded");
  });

  it("more balls than needed still caps at the mix count", () => {
    const s = deriveDoughMixStatus({ mixCount: 2, saved: undefined, ballsRecorded: 130, ballsNeeded: 110 });
    expect(done(s.completedMixes)).toEqual([1, 2]);
  });

  it("partial balls → ceil(balls ÷ balls per mix), estimated", () => {
    // 55 balls per mix.
    expect(done(deriveDoughMixStatus({ mixCount: 2, saved: [], ballsRecorded: 30, ballsNeeded: 110 }).completedMixes)).toEqual([1]);
    expect(done(deriveDoughMixStatus({ mixCount: 2, saved: [], ballsRecorded: 55, ballsNeeded: 110 }).completedMixes)).toEqual([1]);
    expect(done(deriveDoughMixStatus({ mixCount: 2, saved: [], ballsRecorded: 56, ballsNeeded: 110 }).completedMixes)).toEqual([1, 2]);
    const s = deriveDoughMixStatus({ mixCount: 3, saved: [], ballsRecorded: 1, ballsNeeded: 100 });
    expect(done(s.completedMixes)).toEqual([1]);
    expect(s.note).toBe("Estimated from balls recorded");
  });

  it("no balls and nothing saved → nothing done, no note", () => {
    const s = deriveDoughMixStatus({ mixCount: 2, saved: [], ballsRecorded: 0, ballsNeeded: 110 });
    expect(s.completedMixes.size).toBe(0);
    expect(s.note).toBeNull();
  });
});

describe("dough mix status — saved progress wins", () => {
  const saved: SavedDoughMix[] = [
    { mixNo: 1, ticked: [{ ingredientKey: "12" }, { ingredientKey: "Water" }], completedAt: "2026-10-12T08:30:00Z" },
    { mixNo: 2, ticked: [{ ingredientKey: "12" }], completedAt: null },
  ];

  it("a saved complete counts with no balls at all, and is not 'estimated'", () => {
    const s = deriveDoughMixStatus({ mixCount: 2, saved, ballsRecorded: 0, ballsNeeded: 110 });
    expect(done(s.completedMixes)).toEqual([1]);
    expect(s.estimatedMixes.size).toBe(0);
    expect(s.note).toBeNull();
    expect([...s.ticksByMix[1]!].sort()).toEqual(["12", "Water"]);
    expect([...s.ticksByMix[2]!]).toEqual(["12"]);
  });

  it("balls never undo a saved mix; they only fill unmarked ones", () => {
    const onlyMix2: SavedDoughMix[] = [{ mixNo: 2, ticked: [], completedAt: "2026-10-12T09:00:00Z" }];
    // 30 balls ≈ 1 mix — mix 2 is already saved, so nothing is estimated.
    const s = deriveDoughMixStatus({ mixCount: 2, saved: onlyMix2, ballsRecorded: 30, ballsNeeded: 110 });
    expect(done(s.completedMixes)).toEqual([2]);
    expect(s.estimatedMixes.size).toBe(0);
    // All balls → mix 1 filled in as estimated, mix 2 stays recorded.
    const all = deriveDoughMixStatus({ mixCount: 2, saved: onlyMix2, ballsRecorded: 110, ballsNeeded: 110 });
    expect(done(all.completedMixes)).toEqual([1, 2]);
    expect(done(all.estimatedMixes)).toEqual([1]);
  });

  it("ignores saved rows beyond today's mix count", () => {
    const s = deriveDoughMixStatus({ mixCount: 1, saved: [{ mixNo: 3, ticked: [{ ingredientKey: "x" }], completedAt: "t" }], ballsRecorded: 0, ballsNeeded: 50 });
    expect(s.completedMixes.size).toBe(0);
    expect(s.ticksByMix[3]).toBeUndefined();
  });
});

describe("applyDoughMixChange (optimistic update)", () => {
  it("ticks, unticks and completes without touching other mixes", () => {
    let saved: SavedDoughMix[] = [];
    saved = applyDoughMixChange(saved, { action: "tick", mixNo: 2, ingredientKey: "7", ticked: true }, "t1");
    saved = applyDoughMixChange(saved, { action: "tick", mixNo: 1, ingredientKey: "7", ticked: true }, "t2");
    saved = applyDoughMixChange(saved, { action: "tick", mixNo: 1, ingredientKey: "7", ticked: true }, "t3");
    expect(saved.map(m => m.mixNo)).toEqual([1, 2]);
    expect(saved[0]!.ticked.map(t => t.ingredientKey)).toEqual(["7"]);
    saved = applyDoughMixChange(saved, { action: "tick", mixNo: 1, ingredientKey: "7", ticked: false }, "t4");
    expect(saved[0]!.ticked).toEqual([]);
    saved = applyDoughMixChange(saved, { action: "complete", mixNo: 2, completed: true }, "t5");
    expect(saved[1]!.completedAt).toBe("t5");
    expect(saved[1]!.ticked.map(t => t.ingredientKey)).toEqual(["7"]);
  });
});
