import { describe, it, expect } from "vitest";
import { meatLeadMinutes } from "./meat-lead-time";
import {
  isOnDayTimeline, typicalMinutesPerBatch, buildTimingFor, missingBuildTimeWarning,
  splitMeatsByTiming, differsFromFloor, assembleTimingHealth,
} from "./timing-health";

describe("build time on the day schedule", () => {
  it("uses the recipe's own build time when set", () => {
    expect(buildTimingFor(300, 5)).toEqual({ minutesPerBatch: 5, guessed: false });
  });

  it("regression — Philly 2.0 (2026-09-22): no build time is NOT 0 minutes", () => {
    // It used to be counted as 0 so the next recipe landed at the same moment.
    const fallback = typicalMinutesPerBatch([378 / 60, 294 / 60, 267 / 60]);
    const t = buildTimingFor(null, fallback);
    expect(t.guessed).toBe(true);
    expect(t.minutesPerBatch).toBeCloseTo(4.9, 1);
  });

  it("a 0 or negative build time is treated as unset", () => {
    expect(buildTimingFor(0, 4).guessed).toBe(true);
    expect(buildTimingFor(-10, 4).guessed).toBe(true);
  });

  it("typical time is the median of known values, ignoring blanks", () => {
    expect(typicalMinutesPerBatch([5, 4, 6, 0, Number.NaN])).toBe(5);
    expect(typicalMinutesPerBatch([4, 6])).toBe(5);
    expect(typicalMinutesPerBatch([])).toBe(0);
  });

  it("warning says what the schedule did", () => {
    expect(missingBuildTimeWarning("Philly", 4.93)).toBe("Philly: no build time set — timed at a typical 4.9 min a batch (a guess)");
    expect(missingBuildTimeWarning("Philly", 0)).toMatch(/counted as 0 min/);
  });

  it("mac cheese and fried chicken are off the building-line timeline; everything else is on", () => {
    expect(isOnDayTimeline("Macaroni Cheese")).toBe(false);
    // Regression guard: fried chicken (plan 173, 2026-09-21) timed on the
    // builders' line would have pushed the day's end from ~12:40 to 19:33.
    expect(isOnDayTimeline("Fried Chicken")).toBe(false);
    expect(isOnDayTimeline("Desserts")).toBe(true);
    expect(isOnDayTimeline("Calzones")).toBe(true);
    expect(isOnDayTimeline(null)).toBe(true);
  });
});

describe("splitMeatsByTiming", () => {
  const leads = new Map([
    [306, meatLeadMinutes(25, 6)],
    [191, meatLeadMinutes(30, null)],
    [999, meatLeadMinutes(null, 40)],
    [290, meatLeadMinutes(null, null)],
  ]);
  const meats = [
    { rawMeatIngredientId: 306, rawMeatName: "Beef Mince" },
    { rawMeatIngredientId: 191, rawMeatName: "Diced Chicken" },
    { rawMeatIngredientId: 999, rawMeatName: "Process Only" },
    { rawMeatIngredientId: 290, rawMeatName: "Chicken Thighs" },
    { rawMeatIngredientId: 12345, rawMeatName: "Not loaded" },
  ];
  const split = splitMeatsByTiming("Recipe", meats, leads);

  it("fully timed and half-timed meats get a start time, with the gap marked", () => {
    expect(split.timed).toEqual([
      { rawMeatIngredientId: 306, rawMeatName: "Beef Mince", processMinutes: 31, missing: null },
      { rawMeatIngredientId: 191, rawMeatName: "Diced Chicken", processMinutes: 30, missing: "process" },
      { rawMeatIngredientId: 999, rawMeatName: "Process Only", processMinutes: 40, missing: "cook" },
    ]);
  });

  it("regression — a meat with no times no longer disappears from the card", () => {
    expect(split.untimed.map((m) => m.rawMeatIngredientId)).toEqual([290, 12345]);
  });

  it("every gap still produces a warning line", () => {
    expect(split.warnings).toHaveLength(4);
  });
});

describe("assembleTimingHealth", () => {
  const sugg = (value: number, samples = 50) => ({ value, samples, excluded: 0 });

  it("lists missing build times first, most-planned first; flags set values that no longer match the floor", () => {
    const out = assembleTimingHealth({
      recipes: [
        { recipeId: 25, name: "The Benji", category: "Calzones", targetBuildSeconds: null, timesPlanned: 2 },
        { recipeId: 27, name: "Cinnamon Buns", category: "Desserts", targetBuildSeconds: null, timesPlanned: 1 },
        { recipeId: 13, name: "Mac Pork", category: "Macaroni Cheese", targetBuildSeconds: null, timesPlanned: 9 },
        { recipeId: 11, name: "The Don", category: "Calzones", targetBuildSeconds: 600, timesPlanned: 33 },
        { recipeId: 5, name: "Carnizone", category: "Calzones", targetBuildSeconds: 378, timesPlanned: 42 },
      ],
      buildSuggestions: new Map([[25, sugg(352, 21)], [11, sugg(361, 16)], [5, sugg(385, 313)]]),
      meats: [],
      cookSuggestions: new Map(),
    });
    expect(out.recipes.map((r) => [r.recipeId, r.kind])).toEqual([
      [25, "missing"], [27, "missing"], [11, "check"],
    ]);
    expect(out.recipes[0].suggestion).toEqual(sugg(352, 21));
    // Mac cheese (13) is off the day timeline, so its gap isn't listed.
    // Carnizone 378 vs 385 on the floor is within 20% — not flagged.
  });

  it("differsFromFloor needs enough evidence and a real gap", () => {
    expect(differsFromFloor(600, sugg(361, 16))).toBe(true);
    expect(differsFromFloor(600, sugg(361, 9))).toBe(false);
    expect(differsFromFloor(300, sugg(321))).toBe(false);
    expect(differsFromFloor(300, null)).toBe(false);
  });

  it("lists meats missing cook or process time with a cook suggestion where history has one", () => {
    const out = assembleTimingHealth({
      recipes: [],
      buildSuggestions: new Map(),
      meats: [
        { ingredientId: 191, name: "Diced Chicken", cookMinutes: 30, processMinutes: null, usedBy: ["A", "B", "C"] },
        { ingredientId: 290, name: "Chicken Thighs", cookMinutes: null, processMinutes: null, usedBy: ["Open Fire"] },
        { ingredientId: 306, name: "Beef Mince", cookMinutes: 25, processMinutes: 6, usedBy: ["A"] },
        { ingredientId: 154, name: "Diced Beef", cookMinutes: 150, processMinutes: 30, usedBy: ["Philly"] },
        { ingredientId: 251, name: "FC strips (fried chicken only)", cookMinutes: null, processMinutes: null, usedBy: [] },
      ],
      cookSuggestions: new Map([[306, sugg(28)], [154, sugg(227)]]),
    });
    expect(out.meats.map((m) => [m.ingredientId, m.kind, m.missing])).toEqual([
      [191, "missing", "process"],
      [290, "missing", "both"],
      [154, "check", null],
    ]);
    expect(out.meats[1].cookSuggestion).toBeNull();
  });
});
