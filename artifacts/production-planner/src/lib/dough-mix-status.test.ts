import { describe, it, expect } from "vitest";
import { deriveDoughMixStatus, applyDoughMixChange, doughTileSummary, type SavedDoughMix } from "./dough-mix-status";

describe("dashboard Dough Prep tile summary", () => {
  it("nothing started", () => {
    expect(doughTileSummary({ mixCount: 2, saved: [], ballsRecorded: 0, ballsNeeded: 110 }))
      .toEqual({ line: "0 of 2 mixes · 0 of 110 balls", pct: 0, complete: false, empty: false });
  });

  it("mixing shows on the bar before any balls", () => {
    const s = doughTileSummary({ mixCount: 2, saved: [{ mixNo: 1, ticked: [], completedAt: "t" }], ballsRecorded: 0, ballsNeeded: 110 });
    expect(s.line).toBe("1 of 2 mixes · 0 of 110 balls");
    expect(s.pct).toBe(25);
  });

  it("part way through balling", () => {
    const s = doughTileSummary({ mixCount: 2, saved: [{ mixNo: 1, ticked: [], completedAt: "t" }], ballsRecorded: 30, ballsNeeded: 110 });
    expect(s.line).toBe("1 of 2 mixes · 30 of 110 balls");
    expect(s.complete).toBe(false);
    expect(s.pct).toBe(38);
    // 64 balls ≈ more than one mix's worth, so mix 2 is filled in from the
    // balls — exactly as the station shows it.
    expect(doughTileSummary({ mixCount: 2, saved: [{ mixNo: 1, ticked: [], completedAt: "t" }], ballsRecorded: 64, ballsNeeded: 110 }).line)
      .toBe("2 of 2 mixes · 64 of 110 balls");
  });

  it("all mixes and balls → Complete ✓ at 100% (the 12 Oct live case: 110 balls, nothing saved)", () => {
    expect(doughTileSummary({ mixCount: 2, saved: [], ballsRecorded: 110, ballsNeeded: 110 }))
      .toEqual({ line: "Complete ✓", pct: 100, complete: true, empty: false });
  });

  it("all mixes saved but balls short is not complete, and never shows 100", () => {
    const saved = [1, 2].map(n => ({ mixNo: n, ticked: [], completedAt: "t" }));
    const s = doughTileSummary({ mixCount: 2, saved, ballsRecorded: 109, ballsNeeded: 110 });
    expect(s.complete).toBe(false);
    expect(s.pct).toBe(99);
    expect(s.line).toBe("2 of 2 mixes · 109 of 110 balls");
  });

  it("one mix reads singular; no dough → empty", () => {
    expect(doughTileSummary({ mixCount: 1, saved: [], ballsRecorded: 0, ballsNeeded: 40 }).line).toBe("0 of 1 mix · 0 of 40 balls");
    expect(doughTileSummary({ mixCount: 0, saved: [], ballsRecorded: 0, ballsNeeded: 0 }).empty).toBe(true);
  });
});

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

// Regression (2026-10-12 follow-up): the same-day (cinnamon bun) dough cards
// kept ticks in memory only. They now read saved progress the same way; they
// have no balls, so nothing is ever estimated — only saved taps count.
describe("dough mix status — same-day dough (no balls)", () => {
  it("nothing saved → nothing done, even with mixes to make", () => {
    const s = deriveDoughMixStatus({ mixCount: 1, saved: [], ballsRecorded: 0, ballsNeeded: 0 });
    expect(s.completedMixes.size).toBe(0);
    expect(s.note).toBeNull();
  });

  it("saved ticks and a saved complete come back after a reload", () => {
    const saved: SavedDoughMix[] = [
      { mixNo: 1, ticked: [{ ingredientKey: "5" }, { ingredientKey: "x-2" }], completedAt: "2026-10-12T06:10:00Z" },
      { mixNo: 2, ticked: [{ ingredientKey: "5" }], completedAt: null },
    ];
    const s = deriveDoughMixStatus({ mixCount: 2, saved, ballsRecorded: 0, ballsNeeded: 0 });
    expect(done(s.completedMixes)).toEqual([1]);
    expect(s.estimatedMixes.size).toBe(0);
    expect([...s.ticksByMix[1]!].sort()).toEqual(["5", "x-2"]);
    expect([...s.ticksByMix[2]!]).toEqual(["5"]);
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
