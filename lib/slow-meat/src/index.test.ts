import { describe, it, expect } from "vitest";
import {
  capSlowMeatBatches,
  countSlowMeatTrays,
  checkSlowMeatSave,
  describeSlowMeatReductions,
  parseSlowMeatSettings,
  traysFor,
  isSlowMeat,
  type RecipeMeatProfile,
  type SlowMeatSettings,
} from "./index";

const settings: SlowMeatSettings = { minCookMinutes: 120, trayLimit: 11 };

// Shapes taken from the live data (2026-10-01): pork 180 min / 6 kg a tray,
// ~1.22 kg raw pork + marinade a batch; diced beef 210 min / 4.5 kg a tray,
// ~1.61 kg beef + marinade a batch (the slow-cook beef sub-recipe).
const pork = { ingredientId: 22, ingredientName: "Pork", cookTimeMin: 180, trayCapacityKg: 6 };
const beef = { ingredientId: 154, ingredientName: "Diced Beef", cookTimeMin: 210, trayCapacityKg: 4.5 };
const chicken = { ingredientId: 21, ingredientName: "Chicken", cookTimeMin: 25, trayCapacityKg: 4 };

const profiles: RecipeMeatProfile[] = [
  { recipeId: 3, recipeName: "Pulled Pork", meats: [{ ...pork, kgPerBatch: 1.224 }] },
  { recipeId: 26, recipeName: "Philly", meats: [{ ...beef, kgPerBatch: 1.61 }] },
  { recipeId: 7, recipeName: "Chicken Tikka", meats: [{ ...chicken, kgPerBatch: 1.0 }] },
  { recipeId: 12, recipeName: "Honey Pork", meats: [{ ...pork, kgPerBatch: 1.2 }] },
];

describe("traysFor", () => {
  it("rounds up, but an exact fit is not an extra tray", () => {
    expect(traysFor(12, 6)).toBe(2);
    expect(traysFor(12.001, 6)).toBe(3);
    expect(traysFor(0.1 * 3 * 20, 6)).toBe(1); // 6.000000000000001 kg
    expect(traysFor(0, 6)).toBe(0);
  });
});

describe("countSlowMeatTrays", () => {
  it("counts only slow meats, per line per meat", () => {
    const c = countSlowMeatTrays(profiles, [
      { recipeId: 3, batches: 10 },  // 12.24 kg → 3 trays
      { recipeId: 26, batches: 10 }, // 16.1 kg → 4 trays
      { recipeId: 7, batches: 40 },  // chicken: not slow
    ], settings);
    expect(c.totalTrays).toBe(7);
    expect(c.overLimit).toBe(false);
    expect(c.byRecipe.map(r => r.recipeName)).toEqual(["Pulled Pork", "Philly"]);
  });

  it("two recipes sharing one meat keep their own trays (different marinades), summed per meat", () => {
    const c = countSlowMeatTrays(profiles, [
      { recipeId: 3, batches: 5 },  // 6.12 kg → 2
      { recipeId: 12, batches: 5 }, // 6.0 kg → 1
    ], settings);
    expect(c.totalTrays).toBe(3);
    expect(c.byIngredient).toEqual([{ ingredientId: 22, ingredientName: "Pork", kg: 12.12, trays: 3, trayCapacityKg: 6 }]);
  });

  it("a recipe with two slow meats counts both — trays never mix meats", () => {
    const mixed: RecipeMeatProfile[] = [{ recipeId: 50, recipeName: "Surf & Turf", meats: [{ ...pork, kgPerBatch: 1 }, { ...beef, kgPerBatch: 1 }] }];
    const c = countSlowMeatTrays(mixed, [{ recipeId: 50, batches: 5 }], settings);
    // 5 kg pork → 1 tray; 5 kg beef → 2 trays
    expect(c.totalTrays).toBe(3);
    expect(c.byIngredient.map(m => [m.ingredientName, m.trays])).toEqual([["Diced Beef", 2], ["Pork", 1]]);
  });

  it("flags a slow meat with no tray size instead of guessing", () => {
    const noSize: RecipeMeatProfile[] = [
      { recipeId: 3, recipeName: "Pulled Pork", meats: [{ ...pork, kgPerBatch: 1.224 }] },
      { recipeId: 60, recipeName: "Brisket", meats: [{ ingredientId: 99, ingredientName: "Brisket", cookTimeMin: 300, trayCapacityKg: null, kgPerBatch: 2 }] },
    ];
    const c = countSlowMeatTrays(noSize, [{ recipeId: 3, batches: 10 }, { recipeId: 60, batches: 10 }], settings);
    expect(c.totalTrays).toBe(3);
    expect(c.missingTraySize).toEqual([{ ingredientId: 99, ingredientName: "Brisket", recipeNames: ["Brisket"] }]);
  });

  it("threshold boundary: 119 minutes is not slow, 120 is", () => {
    expect(isSlowMeat(119, 120)).toBe(false);
    expect(isSlowMeat(120, 120)).toBe(true);
    expect(isSlowMeat(null, 120)).toBe(false);
    const p = (min: number): RecipeMeatProfile[] => [{ recipeId: 1, recipeName: "X", meats: [{ ingredientId: 1, ingredientName: "M", cookTimeMin: min, trayCapacityKg: 5, kgPerBatch: 1 }] }];
    expect(countSlowMeatTrays(p(119), [{ recipeId: 1, batches: 10 }], settings).totalTrays).toBe(0);
    expect(countSlowMeatTrays(p(120), [{ recipeId: 1, batches: 10 }], settings).totalTrays).toBe(2);
  });
});

describe("capSlowMeatBatches", () => {
  it("leaves a plan under the limit untouched", () => {
    const lines = [{ recipeId: 3, batches: 10 }, { recipeId: 26, batches: 10 }, { recipeId: 7, batches: 40 }];
    const r = capSlowMeatBatches(profiles, lines, settings);
    expect(r.reductions).toEqual([]);
    expect(r.lines).toEqual(lines);
  });

  it("over the limit: reduces fairly to within the limit and no further than needed", () => {
    // 30 pork batches = 36.72 kg → 7 trays; 20 Philly = 32.2 kg → 8 trays; 15 > 11
    const lines = [{ recipeId: 3, batches: 30 }, { recipeId: 26, batches: 20 }, { recipeId: 7, batches: 40 }];
    const r = capSlowMeatBatches(profiles, lines, settings);
    expect(r.before.totalTrays).toBe(15);
    expect(r.after.totalTrays).toBeLessThanOrEqual(11);
    expect(r.lines[2]).toEqual({ recipeId: 7, batches: 40 }); // chicken untouched
    const [porkB, phillyB] = [r.lines[0].batches, r.lines[1].batches];
    expect(porkB).toBeLessThan(30);
    expect(phillyB).toBeLessThan(20);
    // Fair: both cut by a broadly similar share
    expect(Math.abs(porkB / 30 - phillyB / 20)).toBeLessThan(0.2);
    // Maximal: one more batch on either line would break the limit
    for (const i of [0, 1]) {
      const more = r.lines.map((l, j) => (j === i ? { ...l, batches: l.batches + 1 } : l));
      expect(countSlowMeatTrays(profiles, more, settings).totalTrays).toBeGreaterThan(11);
    }
    expect(r.reductions.map(x => [x.recipeName, x.from, x.to])).toEqual([["Pulled Pork", 30, porkB], ["Philly", 20, phillyB]]);
  });

  it("never reduces fixed lines (queued test production) or non-slow lines", () => {
    const lines = [{ recipeId: 3, batches: 30, fixed: true }, { recipeId: 26, batches: 20 }];
    const r = capSlowMeatBatches(profiles, lines, settings);
    expect(r.lines[0].batches).toBe(30); // 7 trays fixed
    expect(r.after.totalTrays).toBeLessThanOrEqual(11);
    expect(r.lines[1].batches).toBe(11); // 11 × 1.61 = 17.71 kg → 4 trays; 12 → 19.32 kg → 5
  });

  it("a tray limit of zero removes all slow-meat batches", () => {
    const r = capSlowMeatBatches(profiles, [{ recipeId: 3, batches: 5 }], { ...settings, trayLimit: 0 });
    expect(r.lines[0].batches).toBe(0);
  });
});

describe("describeSlowMeatReductions", () => {
  it("reads as plain English with the per-meat split", () => {
    const r = capSlowMeatBatches(profiles, [{ recipeId: 3, batches: 30 }, { recipeId: 26, batches: 20 }], settings);
    const text = describeSlowMeatReductions(r);
    expect(text).toMatch(/^Pulled Pork reduced 30 → \d+ batches, Philly 20 → \d+, to stay within 11 trays \(.+\)$/);
    expect(describeSlowMeatReductions({ reductions: [], after: r.after })).toBe("");
  });
});

describe("checkSlowMeatSave", () => {
  const over = countSlowMeatTrays(profiles, [{ recipeId: 3, batches: 30 }, { recipeId: 26, batches: 20 }], settings);
  const less = countSlowMeatTrays(profiles, [{ recipeId: 3, batches: 30 }, { recipeId: 26, batches: 15 }], settings);
  const ok = countSlowMeatTrays(profiles, [{ recipeId: 3, batches: 10 }], settings);

  it("allows anything within the limit", () => {
    expect(checkSlowMeatSave({ after: ok })).toEqual({ ok: true });
  });
  it("blocks a new plan over the limit with a clear message", () => {
    const r = checkSlowMeatSave({ after: over });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("15 trays");
  });
  it("lets an existing over-limit plan be edited as long as trays don't go up", () => {
    expect(checkSlowMeatSave({ before: over, after: over }).ok).toBe(true);
    expect(checkSlowMeatSave({ before: over, after: less }).ok).toBe(true);
    expect(checkSlowMeatSave({ before: less, after: over }).ok).toBe(false);
  });
});

describe("parseSlowMeatSettings", () => {
  it("uses the defaults for missing or bad values", () => {
    expect(parseSlowMeatSettings({})).toEqual({ minCookMinutes: 120, trayLimit: 11 });
    expect(parseSlowMeatSettings({ minCookMinutes: "abc", trayLimit: "-2" })).toEqual({ minCookMinutes: 120, trayLimit: 11 });
    expect(parseSlowMeatSettings({ minCookMinutes: "90", trayLimit: "14" })).toEqual({ minCookMinutes: 90, trayLimit: 14 });
  });
});
