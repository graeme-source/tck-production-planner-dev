import { describe, it, expect } from "vitest";
import {
  reviewRun, needsReason, runsToExclude, trustSignal, reasonCategory, builderFreeAtMinutes, putInToleranceMinutes, REVIEW_RULES,
  type ReviewedRun, type Outcome,
} from "./meat-daily-review";

describe("needsReason — the ask-why threshold", () => {
  it("asks only beyond the tolerance, either side", () => {
    expect(needsReason(10)).toBe(false);
    expect(needsReason(-10)).toBe(false);
    expect(needsReason(11)).toBe(true);
    expect(needsReason(-11)).toBe(true);
    expect(needsReason(null)).toBe(false);
    expect(needsReason(6, { ...REVIEW_RULES, followToleranceMinutes: 5 })).toBe(true);
  });
  it("loading trays takes time: the tolerance widens with the trays, capped", () => {
    expect(putInToleranceMinutes(0)).toBe(10);
    expect(putInToleranceMinutes(6)).toBeCloseTo(13.6);
    expect(putInToleranceMinutes(40)).toBe(20);
    expect(needsReason(13, REVIEW_RULES, 6)).toBe(false);
    expect(needsReason(14, REVIEW_RULES, 6)).toBe(true);
  });
});

// Builders free at 440. Buffer 5: ready by 435 is the aim.
describe("reviewRun", () => {
  it("followed and ready just before needed = perfect, with sat and wait as two numbers", () => {
    const r = reviewRun({ suggestedAtMinutes: 400, putInAtMinutes: 405, readyAtMinutes: 436, neededAtMinutes: 440, bufferMinutes: 5 });
    expect(r).toMatchObject({ deviationMinutes: 5, putIn: "on_time", followed: true, outcome: "perfect", readyInTime: true, waitMinutes: 0, satMinutes: 4, costMinutes: 4, cause: "none" });
  });
  it("a couple of minutes' wait is tap noise, not a fault", () => {
    expect(reviewRun({ suggestedAtMinutes: 400, putInAtMinutes: 400, readyAtMinutes: 443, neededAtMinutes: 440 }).outcome).toBe("perfect");
  });
  it("followed but the builders still waited = the model's fault; waits cost 4x", () => {
    const r = reviewRun({ suggestedAtMinutes: 400, putInAtMinutes: 400, readyAtMinutes: 452, neededAtMinutes: 440 });
    expect(r).toMatchObject({ outcome: "builders_waited", readyInTime: false, waitMinutes: 12, costMinutes: 48, cause: "model" });
  });
  it("sat far longer than the buffer = too early, the model's fault", () => {
    const r = reviewRun({ suggestedAtMinutes: 400, putInAtMinutes: 400, readyAtMinutes: 400, neededAtMinutes: 440, bufferMinutes: 5 });
    expect(r).toMatchObject({ outcome: "too_early", satMinutes: 40, cause: "model" });
    expect(reviewRun({ suggestedAtMinutes: 400, putInAtMinutes: 400, readyAtMinutes: 420, neededAtMinutes: 440, bufferMinutes: 5 }).outcome).toBe("perfect");
  });
  it("put in late without a capacity reason = human", () => {
    const r = reviewRun({ suggestedAtMinutes: 400, putInAtMinutes: 425, readyAtMinutes: 460, neededAtMinutes: 440, reasonCode: "other" });
    expect(r).toMatchObject({ putIn: "late", followed: false, outcome: "builders_waited", cause: "human" });
  });
  it("loading six trays: 13 min off is still followed", () => {
    const r = reviewRun({ suggestedAtMinutes: 400, putInAtMinutes: 413, readyAtMinutes: 452, neededAtMinutes: 440, trayCount: 6 });
    expect(r).toMatchObject({ followed: true, cause: "model" });
  });
  it("put in late because the oven was busy = capacity", () => {
    const r = reviewRun({ suggestedAtMinutes: 400, putInAtMinutes: 425, readyAtMinutes: 460, neededAtMinutes: 440, reasonCode: "oven_busy" });
    expect(r.cause).toBe("capacity");
    expect(reasonCategory("oven_busy")).toBe("capacity");
  });
  it("flags a 4-hour breach: out → last batch built + bake + chill over 240", () => {
    const safety = { totalMinutes: 240, chillMinutes: 120, bakeMinutes: 13 };
    const ok = reviewRun({ suggestedAtMinutes: 400, putInAtMinutes: 400, readyAtMinutes: 436, neededAtMinutes: 440, outAtMinutes: 425, lastBuiltAtMinutes: 520, safety });
    expect(ok).toMatchObject({ safetyMinutes: 228, safetyBreach: false });
    const bad = reviewRun({ suggestedAtMinutes: 400, putInAtMinutes: 400, readyAtMinutes: 436, neededAtMinutes: 440, outAtMinutes: 425, lastBuiltAtMinutes: 560, safety });
    expect(bad).toMatchObject({ safetyMinutes: 268, safetyBreach: true });
    // Measured chill (probe) beats the prediction.
    const measured = reviewRun({ suggestedAtMinutes: 400, putInAtMinutes: 400, readyAtMinutes: 436, neededAtMinutes: 440, outAtMinutes: 425, lastBuiltAtMinutes: 560, chilledAtMinutes: 650, safety });
    expect(measured).toMatchObject({ safetyMinutes: 225, safetyBreach: false });
  });
  it("no suggestion recorded or never built → unknown, never guessed", () => {
    expect(reviewRun({ suggestedAtMinutes: null, putInAtMinutes: 400, readyAtMinutes: 436, neededAtMinutes: 440 })).toMatchObject({ putIn: "unknown", followed: null, outcome: "perfect" });
    expect(reviewRun({ suggestedAtMinutes: 400, putInAtMinutes: 400, readyAtMinutes: null, neededAtMinutes: 440 })).toMatchObject({ outcome: "unknown", cause: "unknown", readyInTime: null, costMinutes: null });
  });
});

const rr = (day: number, followed: boolean | null, dev: number | null, reason: string | null = null): ReviewedRun => ({
  key: `${day}:1`, planDate: `2026-10-${String(day).padStart(2, "0")}`, followed, deviationMinutes: dev, reasonCode: reason,
});

describe("runsToExclude — the follow / didn't-follow split", () => {
  it("one-off human deviations are left out of the learning", () => {
    const { exclude, habit } = runsToExclude([rr(1, true, 2), rr(2, false, 25), rr(3, true, -3), rr(4, true, 0)]);
    expect(habit).toBeNull();
    expect([...exclude]).toEqual(["2:1"]);
  });
  it("capacity reasons are always left out", () => {
    const runs = [1, 2, 3, 4, 5, 6, 7].map(d => rr(d, false, 20, "oven_busy"));
    const { exclude, habit } = runsToExclude(runs);
    expect(habit).toBeNull();
    expect(exclude.size).toBe(7);
  });
  it("a habit in one direction is how the kitchen really runs — kept in", () => {
    const runs = [rr(1, false, -20), rr(2, false, -18), rr(3, false, -25), rr(4, false, -22), rr(5, true, 0), rr(6, false, -19), rr(7, false, -30), rr(8, false, 15)];
    const { exclude, habit } = runsToExclude(runs);
    expect(habit).toBe("early");
    expect([...exclude]).toEqual(["8:1"]); // the one late day is still a one-off
  });
  it("followed runs are never excluded", () => {
    expect(runsToExclude([rr(1, true, 0), rr(2, null, null)]).exclude.size).toBe(0);
  });
});

describe("trustSignal", () => {
  const days = (outcomes: Outcome[]) => outcomes.map((outcome, i) => ({ planDate: `2026-10-${String(30 - i).padStart(2, "0")}`, outcome }));
  it("no data → no score, not trusted", () => {
    expect(trustSignal([])).toEqual({ score: null, days: 0, trusted: false, recent: [] });
  });
  it("earned: enough good days", () => {
    const t = trustSignal(days(["perfect", "perfect", "perfect", "perfect", "perfect"]));
    expect(t.score).toBe(1);
    expect(t.trusted).toBe(true);
  });
  it("not with too few days, however good", () => {
    expect(trustSignal(days(["perfect", "perfect", "perfect", "perfect"])).trusted).toBe(false);
  });
  it("lost straight away when the builders waited today", () => {
    expect(trustSignal(days(["builders_waited", "perfect", "perfect", "perfect", "perfect", "perfect", "perfect"])).trusted).toBe(false);
  });
  it("recent days weigh more than old ones", () => {
    const oldBad = trustSignal(days(["perfect", "perfect", "perfect", "perfect", "perfect", "too_early", "too_early"]));
    const newBad = trustSignal(days(["too_early", "too_early", "perfect", "perfect", "perfect", "perfect", "perfect"]));
    expect(oldBad.score!).toBeGreaterThan(newBad.score!);
    expect(oldBad.trusted).toBe(true);
    expect(newBad.trusted).toBe(false);
  });
  it("unknown days don't count either way", () => {
    expect(trustSignal(days(["unknown", "perfect"])).days).toBe(1);
  });
});

describe("builderFreeAtMinutes", () => {
  const spans = [
    { planItemId: 2, firstTickMinutes: 452, lastTickMinutes: 480 },
    { planItemId: 1, firstTickMinutes: 422, lastTickMinutes: 448 },
  ];
  it("the first recipe is needed at the building start", () => {
    expect(builderFreeAtMinutes(spans, 1, 420)).toBe(420);
    expect(builderFreeAtMinutes(spans, 1, 430)).toBe(422); // never after its own first batch
  });
  it("later recipes when the one before was finished", () => {
    expect(builderFreeAtMinutes(spans, 2, 420)).toBe(448);
  });
  it("never built: null", () => {
    expect(builderFreeAtMinutes(spans, 9, 420)).toBeNull();
  });
});
