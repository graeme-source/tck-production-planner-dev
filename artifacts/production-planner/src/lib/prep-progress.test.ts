import { describe, it, expect } from "vitest";
import {
  prepProgress, mainPrepProgress, basesProgress, rawMeatProgress, tasksLine, progressPct,
  type PrepTick, type PrepTinLine, type PrepProgressInput,
} from "./prep-progress";

// ── Fixture shaped like Wed 14 Oct's plan (prepped Tue 13 Oct) ─────────────
// Ids are illustrative; the shape is what the live /main-prep,
// /sub-recipe-requirements and /prep-requirements-by-recipe responses held.
// Recipes: 1 Margherita, 3 Pulled Pork, 4 Godfather, 5 Carnizone, 6 Roast
// Veg, 8 Duck, 10 Garlic Cheese, 26 Philly, 33 Chicken & Chorizo,
// 34 Properoni Carnizone, 35 Chilli Chorizo.
const ing = (ingredientId: number, ingredientName: string, recipes: Array<[number, number]>): PrepTinLine =>
  ({ ingredientId, ingredientName, recipes: recipes.map(([recipeId, tinCount]) => ({ recipeId, tinCount })) });
const sub = (id: number, name: string, recipes: Array<[number, number]>): PrepTinLine =>
  ({ ...ing(id, name, recipes), isSubRecipe: true });

/** Every tin of every line ticked — how the station looked on 13 Oct. */
function tickAll(lines: PrepTinLine[]): PrepTick[] {
  const out: PrepTick[] = [];
  for (const l of lines) for (const r of l.recipes) for (let t = 1; t <= r.tinCount; t++) {
    out.push({ ingredientId: l.ingredientId, recipeId: r.recipeId, tinNumber: t, isSubRecipe: !!l.isSubRecipe, subRecipeOriginId: r.subRecipeOriginId ?? null });
  }
  return out;
}

// Main prep as the STATION showed it: herbs forced to one tin per recipe,
// sub-recipe rows included — 24 rows, 33 tins.
const MAIN_LINES: PrepTinLine[] = [
  ing(18, "Fresh Basil", [[1, 1], [33, 1]]),
  ing(19, "Rosemary", [[3, 1]]),
  ing(57, "Gherkin", [[4, 2]]),
  ing(11, "Pepperoni", [[5, 3]]),
  ing(12, "Red peppers", [[6, 1], [33, 2]]),
  ing(13, "Red Onions", [[6, 1], [33, 2]]),
  ing(14, "Button Mushrooms", [[6, 1]]),
  ing(16, "Courgettes", [[6, 1]]),
  ing(15, "Spring Onions", [[8, 1]]),
  ing(24, "Duck", [[8, 1]]),
  ing(47, "Mozzarella", [[10, 1]]),
  ing(61, "Cheddar", [[10, 1]]),
  ing(34, "Feta", [[33, 2]]),
  ing(326, "Hot Paprika Crumble", [[33, 2], [35, 1]]),
  ing(300, "Sliced Pepperoni", [[34, 2]]),
  ing(72, "Red Chillis", [[35, 1]]),
  sub(69, "TCK Burger Sauce", [[4, 2]]),
  sub(43, "Garlic Butter", [[10, 1]]),
  sub(44, "Garlic Confit", [[10, 1]]),
  sub(59, "Nacho Cheese Block", [[26, 1]]),
];

const BASES_LINES: PrepTinLine[] = [
  ing(45, "Sticky BBQ", [[3, 2]]),
  ing(58, "Red Onion Chutney", [[4, 2]]),
  ing(97, "Honey", [[5, 3], [34, 2]]),
  ing(28, "Balsamic Glaze", [[6, 1]]),
  ing(49, "Hoisin", [[8, 1]]),
];
const SUB_RECIPES = [
  { subRecipeId: 1, isBase: false },  // dough — not a base task
  { subRecipeId: 2, isBase: true },   // Tomato Base
  { subRecipeId: 43, isBase: false }, // Garlic Butter — a main-prep row
];

const meatRecipe = (recipeId: number, rows: Array<[number, number]>) => ({
  recipeId,
  ingredients: rows.map(([ingredientId, trayCount]) => ({ ingredientId, isRawMeat: true, trayCount })),
});
const MEAT_RECIPES = [
  meatRecipe(3, [[22, 3]]),
  meatRecipe(4, [[306, 3]]),
  meatRecipe(5, [[191, 3], [306, 3]]),
  meatRecipe(26, [[154, 7]]),
  meatRecipe(33, [[191, 2]]),
  meatRecipe(34, [[191, 2], [306, 2]]),
];
const meatTicks = (): PrepTick[] => MEAT_RECIPES.flatMap(r => r.ingredients.flatMap(i =>
  Array.from({ length: i.trayCount }, (_, k) => ({ ingredientId: i.ingredientId, recipeId: r.recipeId, tinNumber: k + 1 }))));

function wed14Oct(): PrepProgressInput {
  // Raw-meat ticks come back on the bases response too (non-main stations
  // get the plan's full completion set), exactly as on live.
  const allNonMainTicks = [...tickAll(BASES_LINES), ...meatTicks()];
  return {
    mainPrep: { ingredients: MAIN_LINES, completions: tickAll(MAIN_LINES), deferrals: [], linkedItems: {}, linkedDone: [] },
    bases: { ingredients: BASES_LINES, completions: allNonMainTicks, subRecipes: SUB_RECIPES, completedSubRecipeIds: [2] },
    rawMeat: { recipes: MEAT_RECIPES, completions: allNonMainTicks },
  };
}

describe("prep progress — Wed 14 Oct regression (tile said 28 / 31 tins, station 33 of 33)", () => {
  it("everything prepped reads as finished: 39 of 39 tasks, 100%", () => {
    const p = prepProgress(wed14Oct());
    expect(p.bySection.main_prep).toMatchObject({ done: 24, total: 24, units: { done: 33, total: 33 } });
    expect(p.bySection.prep_bases).toMatchObject({ done: 7, total: 7, units: { done: 11, total: 11 }, bases: { done: 1, total: 1 } });
    expect(p.bySection.prep_meat).toMatchObject({ done: 8, total: 8, units: { done: 25, total: 25 } });
    expect({ done: p.done, total: p.total, pct: p.pct }).toEqual({ done: 39, total: 39, pct: 100 });
  });

  it("the dashboard tile and each station header are the same numbers", () => {
    const input = wed14Oct();
    const tile = prepProgress(input);
    expect(tile.bySection.main_prep).toEqual(mainPrepProgress(input.mainPrep));
    expect(tile.bySection.prep_bases).toEqual(basesProgress(input.bases));
    expect(tile.bySection.prep_meat).toEqual(rawMeatProgress(input.rawMeat));
  });

  it("sub-recipe rows are tasks (the old tile never saw these 5 tins)", () => {
    const input = wed14Oct();
    // Untick the burger sauce: the tile must now show it as outstanding.
    input.mainPrep!.completions = input.mainPrep!.completions.filter(c => !(c.isSubRecipe && c.ingredientId === 69));
    const p = prepProgress(input);
    expect(p.bySection.main_prep).toMatchObject({ done: 23, total: 24, units: { done: 31, total: 33 } });
    expect(p.done).toBe(38);
  });

  it("only tins the station shows count — no phantom second basil tin", () => {
    // The old tile counted Fresh Basil at 2 tins per recipe; the station
    // shows (and lets you tick) one. A stale tick beyond the line's tins is
    // ignored rather than inflating the count.
    const input = wed14Oct();
    input.mainPrep!.completions.push({ ingredientId: 18, recipeId: 1, tinNumber: 2, isSubRecipe: false, subRecipeOriginId: null });
    expect(prepProgress(input).bySection.main_prep).toMatchObject({ done: 24, total: 24, units: { done: 33, total: 33 } });
  });
});

describe("main prep tasks", () => {
  it("a row is done only when every tin is resolved", () => {
    const lines = [ing(11, "Pepperoni", [[5, 3]])];
    const ticks = tickAll(lines).slice(0, 2);
    expect(mainPrepProgress({ ingredients: lines, completions: ticks, linkedDone: [] }))
      .toMatchObject({ done: 0, total: 1, units: { done: 2, total: 3 } });
  });

  it("a deferred tin counts as resolved (the station's rule)", () => {
    const lines = [ing(11, "Pepperoni", [[5, 2]])];
    const [t1, t2] = tickAll(lines);
    expect(mainPrepProgress({ ingredients: lines, completions: [t1], deferrals: [t2], linkedDone: [] }))
      .toEqual({ done: 1, total: 1, units: { done: 2, total: 2 }, deferredUnits: 1 });
  });

  it("each recipe's row is its own task", () => {
    const lines = [ing(12, "Red peppers", [[6, 1], [33, 2]])];
    const ticks = tickAll(lines).filter(t => t.recipeId === 6);
    expect(mainPrepProgress({ ingredients: lines, completions: ticks, linkedDone: [] }))
      .toMatchObject({ done: 1, total: 2 });
  });

  it("one ingredient through two sub-recipes of a recipe is one row, done when both are", () => {
    const line: PrepTinLine = {
      ingredientId: 61, ingredientName: "Cheddar",
      recipes: [{ recipeId: 9, tinCount: 1, subRecipeOriginId: 70 }, { recipeId: 9, tinCount: 1, subRecipeOriginId: 71 }],
    };
    const sauceOnly: PrepTick[] = [{ ingredientId: 61, recipeId: 9, tinNumber: 1, subRecipeOriginId: 70 }];
    expect(mainPrepProgress({ ingredients: [line], completions: sauceOnly, linkedDone: [] }))
      .toMatchObject({ done: 0, total: 1, units: { done: 1, total: 2 } });
    const both = [...sauceOnly, { ingredientId: 61, recipeId: 9, tinNumber: 1, subRecipeOriginId: 71 }];
    expect(mainPrepProgress({ ingredients: [line], completions: both, linkedDone: [] }).done).toBe(1);
  });

  it("a whole-sub-recipe tick never ticks an ingredient that shares its id", () => {
    const lines = [ing(43, "Oregano", [[5, 1]])];
    const subTick: PrepTick = { ingredientId: 43, recipeId: 5, tinNumber: 1, isSubRecipe: true };
    expect(mainPrepProgress({ ingredients: lines, completions: [subTick], linkedDone: [] }).done).toBe(0);
  });

  it("tickable linked rows (pasta water / salt) are tasks; display-only rows aren't", () => {
    const lines = [ing(80, "Macaroni", [[40, 1]])];
    const linkedItems = { 80: [{ key: "pasta_water:80" }, { key: "pasta_salt:80" }, {}] };
    expect(mainPrepProgress({ ingredients: lines, completions: tickAll(lines), linkedItems, linkedDone: ["pasta_water:80"] }))
      .toMatchObject({ done: 2, total: 3 });
  });

  it("rows with no tins (overridden to 0) aren't tasks", () => {
    expect(mainPrepProgress({ ingredients: [ing(11, "Pepperoni", [[5, 0]])], completions: [], linkedDone: [] }))
      .toMatchObject({ done: 0, total: 0 });
  });
});

describe("bases & sauces tasks", () => {
  it("each sauce row plus each base sub-recipe", () => {
    const p = basesProgress({
      ingredients: BASES_LINES, completions: [], subRecipes: SUB_RECIPES, completedSubRecipeIds: [2],
    });
    expect(p).toEqual({ done: 1, total: 7, units: { done: 0, total: 11 }, bases: { done: 1, total: 1 } });
  });

  it("a deferral doesn't finish a sauce (no defer on this station)", () => {
    const lines = [ing(28, "Balsamic Glaze", [[6, 1]])];
    const p = basesProgress({ ingredients: lines, completions: [], subRecipes: [], completedSubRecipeIds: [] });
    expect(p.done).toBe(0);
  });

  it("'Normal Base' is the pinned Tomato Base, not a second sauce task", () => {
    const lines = [ing(5, "Normal Base", [[1, 2]]), ing(28, "Balsamic Glaze", [[6, 1]])];
    expect(basesProgress({ ingredients: lines, completions: [], subRecipes: [], completedSubRecipeIds: [] }).total).toBe(1);
  });
});

describe("raw meat tasks", () => {
  it("each raw-meat ingredient per recipe; done when every tray is ticked", () => {
    const recipes = [meatRecipe(33, [[191, 2]]), meatRecipe(34, [[191, 2], [306, 2]])];
    const ticks: PrepTick[] = [
      { ingredientId: 191, recipeId: 33, tinNumber: 1 }, { ingredientId: 191, recipeId: 33, tinNumber: 2 },
      { ingredientId: 191, recipeId: 34, tinNumber: 1 },
    ];
    expect(rawMeatProgress({ recipes, completions: ticks })).toEqual({ done: 1, total: 3, units: { done: 3, total: 6 } });
  });

  it("seasonings and tray-less rows aren't tasks", () => {
    const recipes = [{ recipeId: 5, ingredients: [
      { ingredientId: 191, isRawMeat: true, trayCount: 1 },
      { ingredientId: 500, isRawMeat: false, trayCount: null },
      { ingredientId: 306, isRawMeat: true, trayCount: null },
    ] }];
    expect(rawMeatProgress({ recipes, completions: [] }).total).toBe(1);
  });
});

describe("wording", () => {
  it("tasks line and percent", () => {
    expect(tasksLine({ done: 1, total: 1 })).toBe("1 of 1 task");
    expect(tasksLine({ done: 38, total: 39 })).toBe("38 of 39 tasks");
    expect(progressPct({ done: 38, total: 39 })).toBe(97);
    expect(progressPct({ done: 0, total: 0 })).toBe(0);
  });

  it("nothing loaded yet is zero, not a crash", () => {
    expect(prepProgress({ mainPrep: null, bases: null, rawMeat: null })).toMatchObject({ done: 0, total: 0, pct: 0 });
  });
});
