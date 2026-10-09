import { describe, expect, it } from "vitest";
import {
  buildNumbers, planBuildEdit, editBlockReason, lowestAllowed, editSummary, removalOrder,
  lineNumbers, lineCanGive, lineLabel, PACK_WORDS, linesByRecentWork, planExtraPackTap, type BuildCompletion, type BuildEditState,
} from "./index";

const at = (min: number) => new Date(Date.UTC(2026, 9, 9, 8, min)).toISOString();
const full = (id: number, line: string, min: number): BuildCompletion => ({ id, stationType: line, completedAt: at(min), partialPacks: null });
const part = (id: number, line: string, min: number, packs: number): BuildCompletion => ({ id, stationType: line, completedAt: at(min), partialPacks: packs });

function state(over: Partial<BuildEditState> = {}): BuildEditState {
  return {
    completions: [full(1, "building_1", 0), full(2, "building_2", 5), full(3, "building_1", 10)],
    stationExtras: {},
    packsPerBatch: 5,
    ovenBatches: 0,
    packsStored: 0,
    ...over,
  };
}

describe("buildNumbers", () => {
  it("counts both lines' batches and packs", () => {
    expect(buildNumbers(state())).toEqual({ batches: 3, partBatches: 0, partBatchPacks: 0, extraPacks: 0, totalPacks: 15 });
  });

  it("a part batch counts as a batch, and its shortfall is not shown as negative extra packs", () => {
    // Plan 191, Margherita: one part batch of 4 (5 a batch) left extra_packs at −1.
    const s = state({ completions: [full(1, "building_1", 0), part(2, "building_1", 9, 4)], stationExtras: { building_1: -1 } });
    expect(buildNumbers(s)).toEqual({ batches: 2, partBatches: 1, partBatchPacks: 4, extraPacks: 0, totalPacks: 9 });
  });

  it("loose packs on either line add up", () => {
    expect(buildNumbers(state({ stationExtras: { building_1: 2, building_2: 1 } })).extraPacks).toBe(3);
  });
});

describe("removalOrder", () => {
  it("only the chosen line's rows: newest full batch first, part batches last", () => {
    const rows = [full(1, "building_1", 0), full(2, "building_2", 20), part(3, "building_1", 30, 3), full(4, "building_1", 10)];
    expect(removalOrder(rows, "building_1").map(c => c.id)).toEqual([4, 1, 3]);
    expect(removalOrder(rows, "building_2").map(c => c.id)).toEqual([2]);
  });
});

describe("lineNumbers / lineCanGive / lineLabel", () => {
  it("each line's own batches and loose packs (part-batch shortfall given back)", () => {
    const s = state({ completions: [full(1, "building_1", 0), part(2, "building_2", 5, 3)], stationExtras: { building_1: 2, building_2: -2 } });
    expect(lineNumbers(s, "building_1")).toEqual({ batches: 1, extraPacks: 2 });
    expect(lineNumbers(s, "building_2")).toEqual({ batches: 1, extraPacks: 0 });
    expect(lineCanGive(s, "building_2", "extraPacks", 1)).toBe(false);
    expect(lineCanGive(s, "building_1", "extraPacks", 2)).toBe(true);
    expect(lineCanGive(s, "building_1", "batches", 2)).toBe(false);
    expect(lineCanGive(s, "building_2", "batches", 0)).toBe(true);
  });
  it("names lines the way the floor does", () => {
    expect(lineLabel("building_2")).toBe("Line 2");
  });
});

describe("planBuildEdit", () => {
  it("−1 batch removes the most recent batch on this line", () => {
    const plan = planBuildEdit(state(), { batches: 2, extraPacks: 0 }, "building_1");
    expect(plan.removeCompletionIds).toEqual([3]);
    expect(plan.addBatches).toBe(0);
    expect(plan.extrasDelta).toEqual({});
    expect(plan.after.totalPacks).toBe(10);
  });

  it("takes off the line the builder chose, not the editing line", () => {
    const plan = planBuildEdit(state(), { batches: 2, extraPacks: 0 }, { batches: "building_2", extraPacks: "building_1" });
    expect(plan.removeCompletionIds).toEqual([2]);
  });

  it("adds to the line the builder chose", () => {
    const plan = planBuildEdit(state(), { batches: 4, extraPacks: 1 }, { batches: "building_2", extraPacks: "building_2" });
    expect(plan.addBatches).toBe(1);
    expect(plan.extrasDelta).toEqual({ building_2: 1 });
  });

  it("+1 batch records one more on this line", () => {
    const plan = planBuildEdit(state(), { batches: 4, extraPacks: 0 }, "building_2");
    expect(plan.removeCompletionIds).toEqual([]);
    expect(plan.addBatches).toBe(1);
    expect(plan.after.batches).toBe(4);
  });

  it("+extra packs go on this line", () => {
    const plan = planBuildEdit(state(), { batches: 3, extraPacks: 2 }, "building_1");
    expect(plan.extrasDelta).toEqual({ building_1: 2 });
    expect(plan.after).toMatchObject({ extraPacks: 2, totalPacks: 17 });
  });

  it("−extra packs come off the chosen line only, and a line can't give more than it holds", () => {
    const s = state({ stationExtras: { building_1: 1, building_2: 2 } });
    expect(planBuildEdit(s, { batches: 3, extraPacks: 1 }, "building_2").extrasDelta).toEqual({ building_2: -2 });
    expect(editBlockReason(s, { batches: 3, extraPacks: 1 }, "building_1")).toBe("Line 1 has only 1 extra pack on this recipe.");
    expect(editBlockReason(s, { batches: 3, extraPacks: 1 }, "building_2")).toBeNull();
  });

  it("a line can't give up more batches than it recorded", () => {
    expect(editBlockReason(state(), { batches: 1, extraPacks: 0 }, "building_2")).toBe("Line 2 has only 1 batch of this recipe recorded.");
    expect(editBlockReason(state(), { batches: 1, extraPacks: 0 }, "building_1")).toBeNull();
  });

  it("removing a part batch takes its own packs with it and leaves extra packs alone", () => {
    const s = state({ completions: [part(9, "building_2", 0, 4)], stationExtras: { building_2: -1 } });
    const plan = planBuildEdit(s, { batches: 0, extraPacks: 0 }, "building_2");
    expect(plan.removeCompletionIds).toEqual([9]);
    expect(plan.extrasDelta).toEqual({ building_2: 1 });
    expect(plan.after).toMatchObject({ batches: 0, extraPacks: 0, totalPacks: 0 });
  });

  it("the worked example: Batches 6 → 5, Extra packs 0 → 2", () => {
    const s = state({ completions: [1, 2, 3, 4, 5, 6].map(i => full(i, "building_1", i)) });
    const plan = planBuildEdit(s, { batches: 5, extraPacks: 2 }, "building_1");
    expect(plan.removeCompletionIds).toEqual([6]);
    expect(plan.after).toMatchObject({ batches: 5, extraPacks: 2, totalPacks: 27 });
    expect(editSummary(plan.before, plan.after)).toBe("Batches 6 → 5, Extra packs 0 → 2");
    expect(editSummary(plan.before, plan.after, undefined, { batches: "building_2", extraPacks: "building_1" }))
      .toBe("Batches 6 → 5 (taken off Line 2), Extra packs 0 → 2 (added to Line 1)");
  });
});

describe("editBlockReason / lowestAllowed (downstream floors)", () => {
  it("can't drop below batches already through the ovens", () => {
    const s = state({ ovenBatches: 3 });
    expect(editBlockReason(s, { batches: 2, extraPacks: 0 }, "building_1")).toMatch(/3 batches have already gone through the ovens/);
    expect(lowestAllowed(s, { batches: 3, extraPacks: 0 }, "batches")).toBe(3);
  });

  it("can't drop the pack total below what's already wrapped into storage", () => {
    const s = state({ stationExtras: { building_1: 2 }, packsStored: 16 });
    expect(editBlockReason(s, { batches: 3, extraPacks: 0 }, "building_1")).toMatch(/16 packs are already wrapped/);
    expect(lowestAllowed(s, { batches: 3, extraPacks: 2 }, "extraPacks")).toBe(1);
    expect(editBlockReason(s, { batches: 3, extraPacks: 1 }, "building_1")).toBeNull();
  });

  it("never below zero", () => {
    expect(editBlockReason(state(), { batches: -1, extraPacks: 0 }, "building_1")).not.toBeNull();
    expect(editBlockReason(state(), { batches: 0, extraPacks: -1 }, "building_1")).not.toBeNull();
    expect(lowestAllowed(state(), { batches: 3, extraPacks: 0 }, "batches")).toBe(1); // one line per save: Line 1 holds 2 of the 3
  });

  it("a negative extra-pack count left by the old Undo can be kept or raised, not lowered", () => {
    // Part batch of 3 removed by the old Undo: its −2 stayed on the line.
    const s = state({ stationExtras: { building_2: -2 } });
    expect(buildNumbers(s).extraPacks).toBe(-2);
    expect(editBlockReason(s, { batches: 2, extraPacks: -2 }, "building_1")).toBeNull();
    expect(editBlockReason(s, { batches: 3, extraPacks: -3 }, "building_1")).not.toBeNull();
    expect(lowestAllowed(s, { batches: 3, extraPacks: -2 }, "extraPacks")).toBe(-2);
  });

  it("uses pack words for recipes counted in packs", () => {
    expect(editBlockReason(state({ ovenBatches: 1 }), { batches: 0, extraPacks: 0 }, "building_1", PACK_WORDS)).toMatch(/^1 pack has already/);
  });
});

describe("editSummary", () => {
  it("is empty when nothing changed", () => {
    expect(editSummary({ batches: 4, extraPacks: 1 }, { batches: 4, extraPacks: 1 })).toBe("");
  });
  it("names packs for pack-counted recipes", () => {
    expect(editSummary({ batches: 4, extraPacks: 0 }, { batches: 5, extraPacks: 0 }, PACK_WORDS)).toBe("Packs 4 → 5");
  });
});

describe("linesByRecentWork", () => {
  it("puts the line with the newest batch first", () => {
    expect(linesByRecentWork([full(1, "building_1", 0), full(2, "building_2", 5)])).toEqual(["building_2", "building_1"]);
    expect(linesByRecentWork([full(1, "building_1", 9), full(2, "building_2", 5)])).toEqual(["building_1", "building_2"]);
  });
  it("building_1 first when nothing is recorded; a line with batches beats one without", () => {
    expect(linesByRecentWork([])).toEqual(["building_1", "building_2"]);
    expect(linesByRecentWork([full(1, "building_2", 0)])).toEqual(["building_2", "building_1"]);
  });
});

describe("planExtraPackTap (oven + building Extra packs counters)", () => {
  // Regression, 9 Oct 2026: the oven counter sent no building line and every
  // tap was refused. A tap without a line now lands on one.
  it("oven +1 goes on the line that recorded this recipe most recently", () => {
    // state(): building_1's batch at :10 is the newest.
    expect(planExtraPackTap(state(), 1)).toEqual({ ok: true, line: "building_1", extrasDelta: { building_1: 1 } });
    const s = state({ completions: [full(1, "building_1", 0), full(2, "building_2", 30)] });
    expect(planExtraPackTap(s, 1)).toEqual({ ok: true, line: "building_2", extrasDelta: { building_2: 1 } });
  });
  it("oven +1 with no batches yet goes on building_1", () => {
    expect(planExtraPackTap(state({ completions: [] }), 1)).toMatchObject({ ok: true, line: "building_1" });
  });
  it("oven −1 comes off the most recent line that holds loose packs", () => {
    const s = state({ stationExtras: { building_1: 2, building_2: 1 } });
    expect(planExtraPackTap(s, -1)).toEqual({ ok: true, line: "building_1", extrasDelta: { building_1: -1 } });
    // The most recent line (building_1) holds none, so the other line's pack.
    const s2 = state({ stationExtras: { building_1: 0, building_2: 1 } });
    expect(planExtraPackTap(s2, -1)).toEqual({ ok: true, line: "building_2", extrasDelta: { building_2: -1 } });
  });
  it("oven −1 never pushes a line below 0", () => {
    expect(planExtraPackTap(state(), -1)).toEqual({ ok: false, reason: "There are no extra packs to take off." });
    // A part batch's shortfall (−1 on its line) is not a loose pack to take.
    const s = state({ completions: [full(1, "building_1", 0), part(2, "building_1", 9, 4)], stationExtras: { building_1: -1 } });
    expect(planExtraPackTap(s, -1).ok).toBe(false);
  });
  it("−1 can't take the total below what's already wrapped", () => {
    const s = state({ stationExtras: { building_2: 1 }, packsStored: 16 });
    const r = planExtraPackTap(s, -1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/16 packs are already wrapped/);
  });
  it("a building line's own counter only changes that line", () => {
    const s = state({ stationExtras: { building_1: 0, building_2: 3 } });
    expect(planExtraPackTap(s, 1, "building_2")).toEqual({ ok: true, line: "building_2", extrasDelta: { building_2: 1 } });
    expect(planExtraPackTap(s, -1, "building_2")).toEqual({ ok: true, line: "building_2", extrasDelta: { building_2: -1 } });
    expect(planExtraPackTap(s, -1, "building_1")).toEqual({ ok: false, reason: "This line has no extra packs to take off." });
  });
});
