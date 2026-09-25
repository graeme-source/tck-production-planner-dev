import { describe, it, expect } from "vitest";
import { computeDaySchedule, computeScheduleFromSlots, type ScheduleRecipeInput, type ScheduleOptions } from "./index";

const opts: ScheduleOptions = { startMinutes: 7 * 60, buildersCount: 2, changeoverSeconds: 120, breaks: [] };

const recipe = (over: Partial<ScheduleRecipeInput>): ScheduleRecipeInput => ({
  planItemId: 1, recipeId: 1, name: "R", batches: 10, minutesPerBatch: 5, ...over,
});

describe("computeDaySchedule — timing gaps ride through to the UI", () => {
  it("times a recipe as before and marks nothing when every input is set", () => {
    const s = computeDaySchedule([
      recipe({ meats: [{ rawMeatIngredientId: 9, rawMeatName: "Pork", processMinutes: 240 }] }),
    ], opts);
    const r = s.recipes[0];
    expect(r.buildMinutes).toBe(25); // 10 × 5 ÷ 2
    expect(r.buildTimeGuessed).toBe(false);
    expect(r.untimedMeats).toEqual([]);
    expect(r.meats[0]).toMatchObject({ cookStartMinutes: 420 - 240, beforeShiftStart: true, missing: null });
  });

  it("carries the guessed-build-time flag without changing the maths", () => {
    const s = computeDaySchedule([
      recipe({ planItemId: 1, minutesPerBatch: 5 }),
      recipe({ planItemId: 2, recipeId: 2, minutesPerBatch: 5, buildTimeGuessed: true }),
    ], opts);
    expect(s.recipes[1].buildTimeGuessed).toBe(true);
    // Regression (Philly 2.0, 2026-09-22): a recipe must never take 0 minutes
    // just because its build time is unset — the stand-in still takes time.
    expect(s.recipes[1].buildMinutes).toBe(25);
    expect(s.recipes[1].startMinutes).toBe(420 + 25 + 2);
  });

  it("passes through half-known meat lead times and meats with no time at all", () => {
    const s = computeDaySchedule([
      recipe({
        meats: [{ rawMeatIngredientId: 191, rawMeatName: "Diced chicken", processMinutes: 30, missing: "process" }],
        untimedMeats: [{ rawMeatIngredientId: 290, rawMeatName: "Chicken thighs" }],
      }),
    ], opts);
    expect(s.recipes[0].meats[0].missing).toBe("process");
    expect(s.recipes[0].untimedMeats).toEqual([{ rawMeatIngredientId: 290, rawMeatName: "Chicken thighs" }]);
  });

  it("slot-ordered timeline carries the same flags", () => {
    const s = computeScheduleFromSlots([
      { kind: "recipe", recipe: recipe({ buildTimeGuessed: true, untimedMeats: [{ rawMeatIngredientId: 1, rawMeatName: "X" }] }) },
    ], opts);
    expect(s.recipes[0].buildTimeGuessed).toBe(true);
    expect(s.recipes[0].untimedMeats).toHaveLength(1);
  });
});
