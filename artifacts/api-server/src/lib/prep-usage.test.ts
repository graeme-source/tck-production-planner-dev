import { describe, it, expect } from "vitest";
import { prepUsagePerBatch, type UsageIngredient, type UsageRecipe, type UsageSubRecipe } from "./prep-usage";

const ing = (id: number, over: Partial<UsageIngredient> = {}): UsageIngredient => ({
  id, name: `Ingredient ${id}`, unit: "kg", category: null, processingRatio: null, prepWeightMode: "raw", prepCountPerPortion: null, ...over,
});
const sub = (id: number, over: Partial<UsageSubRecipe> = {}): UsageSubRecipe => ({
  id, name: `Sub ${id}`, yield: 1, yieldUnit: "kg", expandInPrep: false, ingredients: [], subRecipes: [], ...over,
});
const line = (ingredientId: number, quantity: number, over: Partial<UsageRecipe["ingredients"][number]> = {}) => ({
  ingredientId, quantity, isTopping: false, marinadeForIngredientId: null, includeInFillingMix: false, ...over,
});
const subLine = (subRecipeId: number, quantity: number, over: Partial<UsageRecipe["subRecipes"][number]> = {}) => ({
  subRecipeId, quantity, isTopping: false, marinadeForIngredientId: null, ...over,
});
const recipe = (over: Partial<UsageRecipe>): UsageRecipe => ({ id: 1, portionsPerBatch: 10, ingredients: [], subRecipes: [], ...over });
const usageOf = (r: UsageRecipe, ings: UsageIngredient[], subs: UsageSubRecipe[] = [], rules = {}) =>
  Object.fromEntries(prepUsagePerBatch(r, new Map(ings.map(i => [i.id, i])), new Map(subs.map(s => [s.id, s])), rules)
    .map(u => [u.itemKey, u.grams ?? `${u.count} ${u.countUnit}`]));

describe("prepUsagePerBatch", () => {
  it("scales per-portion quantities to a batch, in grams, on the raw basis", () => {
    // 20 g cooked onion per portion × 10 portions, 0.5 cooked per raw → 400 g raw.
    const u = usageOf(recipe({ ingredients: [line(1, 0.02)] }), [ing(1, { processingRatio: 0.5 })]);
    expect(u["ingredient:1"]).toBeCloseTo(400);
  });

  it("uses the processed weight when the ingredient preps that way", () => {
    const u = usageOf(recipe({ ingredients: [line(1, 0.02)] }), [ing(1, { processingRatio: 0.5, prepWeightMode: "processed" })]);
    expect(u["ingredient:1"]).toBeCloseTo(200);
  });

  it("counts pieces for an ingredient prepped by count", () => {
    const u = usageOf(recipe({ ingredients: [line(1, 0.05)] }), [ing(1, { prepCountPerPortion: 2 })]);
    expect(u["ingredient:1"]).toBe("20 pieces");
  });

  it("leaves out toppings, marinade lines and lines the screens don't prep", () => {
    const u = usageOf(
      recipe({ ingredients: [line(1, 0.01, { isTopping: true }), line(2, 0.01, { marinadeForIngredientId: 5 }), line(3, 0.03), line(4, 0.01)] }),
      [ing(1), ing(2), ing(3, { name: "Mozzarella" }), ing(4)],
      [],
      { notPrepped: (i: UsageIngredient, l: { includeInFillingMix: boolean }) => i.name === "Mozzarella" && !l.includeInFillingMix },
    );
    expect(Object.keys(u)).toEqual(["ingredient:4"]);
  });

  it("takes a sub-recipe made as a whole in its yield unit — shared items allocate by usage", () => {
    // 43 g of Tomato Base per portion → 430 g a batch, whatever else uses it.
    const u = usageOf(recipe({ subRecipes: [subLine(2, 0.043)] }), [], [sub(2, { yield: 11.479 })]);
    expect(u["sub_recipe:2"]).toBeCloseTo(430);
  });

  it("lists an expand-in-prep sub-recipe as its ingredients and nested sub-recipes, scaled by its yield", () => {
    const sauce = sub(48, {
      yield: 32.5, expandInPrep: true,
      ingredients: [
        { ingredientId: 7, quantity: 6.5, hideFromPrep: false, marinadeForIngredientId: null },
        { ingredientId: 8, quantity: 1, hideFromPrep: true, marinadeForIngredientId: null },
      ],
      subRecipes: [{ subRecipeId: 49, quantity: 0.65, marinadeForIngredientId: null }],
    });
    // 0.325 kg/portion × 2 portions = 0.65 kg of a 32.5 kg yield → 2% of it.
    const u = usageOf(recipe({ portionsPerBatch: 2, subRecipes: [subLine(48, 0.325)] }), [ing(7), ing(8)], [sauce, sub(49)]);
    expect(u["ingredient:7"]).toBeCloseTo(130);
    expect(u["sub_recipe:49"]).toBeCloseTo(13);
    expect(u["ingredient:8"]).toBeUndefined();
    expect(u["sub_recipe:48"]).toBeUndefined();
  });

  it("adds an item reached two ways together", () => {
    const topping = sub(50, { yield: 1, expandInPrep: true, ingredients: [{ ingredientId: 7, quantity: 0.5, hideFromPrep: false, marinadeForIngredientId: null }] });
    const u = usageOf(recipe({ ingredients: [line(7, 0.01)], subRecipes: [subLine(50, 0.02)] }), [ing(7)], [topping]);
    expect(u["ingredient:7"]).toBeCloseTo(100 + 100);
  });

  it("counts raw meat inside a sub-recipe made as a whole, raw, through nested sub-recipes", () => {
    const beef = ing(30, { category: "raw_meat", processingRatio: 0.621 });
    const stock = ing(31);
    const philly = sub(68, {
      yield: 0.9694,
      ingredients: [
        { ingredientId: 30, quantity: 0.9694, hideFromPrep: false, marinadeForIngredientId: null },
        { ingredientId: 31, quantity: 0.1, hideFromPrep: false, marinadeForIngredientId: 30 },
      ],
      subRecipes: [{ subRecipeId: 69, quantity: 0.9694, marinadeForIngredientId: null }],
    });
    const inner = sub(69, { yield: 1, ingredients: [{ ingredientId: 30, quantity: 0.1, hideFromPrep: false, marinadeForIngredientId: null }], subRecipes: [{ subRecipeId: 68, quantity: 1, marinadeForIngredientId: null }] });
    const u = usageOf(recipe({ subRecipes: [subLine(68, 0.1)] }), [beef, stock], [philly, inner], { preppedWithMeat: (i: UsageIngredient) => i.category === "raw_meat" });
    expect(u["sub_recipe:68"]).toBeCloseTo(1000);
    // 1 kg cooked straight in + 0.1 kg through the nested one, all ÷ 0.621 raw;
    // the cycle back to 68 stops there.
    expect(u["ingredient:30"]).toBeCloseTo((1000 + 100) / 0.621);
    expect(u["ingredient:31"]).toBeUndefined();
  });

  it("falls back to ten portions a batch when the recipe has none", () => {
    const u = usageOf(recipe({ portionsPerBatch: 0, ingredients: [line(1, 0.01)] }), [ing(1)]);
    expect(u["ingredient:1"]).toBeCloseTo(100);
  });
});
