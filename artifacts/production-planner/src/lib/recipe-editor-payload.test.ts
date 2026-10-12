import { describe, expect, it } from "vitest";
import { buildRecipeCreatePayload, buildRecipeUpdatePayload, buildSubRecipePayload } from "./recipe-editor-payload";
import { formatLineCost, recipeIngredientLineCost, recipeSubRecipeLineCost, subRecipeIngredientLineCost } from "./recipe-line-cost";

// The recipe form's validated values for a typical edit (fixture).
const recipeForm = {
  name: "Carnizone",
  category: "Calzones",
  description: "",
  servings: 1,
  servingUnit: "portion",
  notes: "Hot",
  packSize: 2,
  rrp: 13.95,
  packagingCost: 0.4,
  labourCost: 1.1,
  portionsPerBatch: 10,
  targetBuildMinutes: 4.5,
  shelfLifeDays: 13,
  tinSize: "XXL",
  maxBatchesPerTin: 10,
  sopUrl: "",
  isCoreMenu: true,
  isCurrentSpecial: false,
  isFridgeProduct: true,
  color: "#db0000",
  secondaryColor: "#facc15",
  cookingLossPercent: 3,
  builderFillingDeductionGrams: 0,
  dietaryCategory: "meat" as const,
  ovenTempC: 200,
  ovenTimeMinutes: 6,
  tags: ["spicy"],
  startAsDraft: undefined,
  ingredients: [
    { ingredientId: 7, quantity: 0.12, marinadeForIngredientId: null, marinadeAddAtCooking: false, includeInFillingMix: true, isTopping: false, quid: true, showInPrep: false, mixingOverage: 0.005 },
    { ingredientId: 9, quantity: 0.01, marinadeForIngredientId: 7, marinadeAddAtCooking: true, includeInFillingMix: false, isTopping: false, quid: false, showInPrep: true, mixingOverage: 0 },
  ],
  subRecipes: [
    { subRecipeId: 3, quantity: 0.05, marinadeForIngredientId: null, marinadeAddAtCooking: false, includeInFillingMix: true, isTopping: true, quid: false, showInPrep: false, mixingOverage: 0 },
  ],
};

// Exactly what EditRecipeDialog / the New recipe dialog sent before the
// editors were merged (pages/recipes.tsx at 6cb448c3): the form values minus
// targetBuildMinutes / isFridgeProduct / ovenTimeMinutes / startAsDraft, line
// quid ticks stripped, then the timing fields in seconds.
const { targetBuildMinutes: _t, isFridgeProduct: _f, ovenTimeMinutes: _o, startAsDraft: _s, ...rest } = recipeForm;
const strip = (lines: Array<Record<string, unknown>>) => lines.map(({ quid: _q, ...l }) => l);
const before = {
  ...rest,
  ingredients: strip(rest.ingredients),
  subRecipes: strip(rest.subRecipes),
  targetBuildSeconds: 270,
  ovenTempC: 200,
  ovenTimeSeconds: 360,
};

describe("recipe payloads are unchanged by the shared editor", () => {
  it("update (not a draft)", () => {
    const { body, isFridgeProduct } = buildRecipeUpdatePayload(recipeForm, { isDraft: false });
    expect(body).toEqual(before);
    expect(JSON.stringify(body)).toBe(JSON.stringify(before));
    expect(isFridgeProduct).toBe(true);
  });

  it("update of a draft with Core menu ticked publishes it", () => {
    const { body } = buildRecipeUpdatePayload(recipeForm, { isDraft: true });
    expect(body).toEqual({ ...before, publishDraft: true });
  });

  it("update with blank timings sends nulls", () => {
    const { body } = buildRecipeUpdatePayload({ ...recipeForm, targetBuildMinutes: null, ovenTimeMinutes: null, ovenTempC: null }, { isDraft: false });
    expect(body.targetBuildSeconds).toBeNull();
    expect(body.ovenTimeSeconds).toBeNull();
    expect(body.ovenTempC).toBeNull();
  });

  it("create sends isDraft, never while on the menu", () => {
    const asDraft = buildRecipeCreatePayload({ ...recipeForm, isCoreMenu: false, startAsDraft: true });
    expect(asDraft.isDraft).toBe(true);
    expect(asDraft.body).toEqual({ ...before, isCoreMenu: false, isDraft: true });
    const onMenu = buildRecipeCreatePayload({ ...recipeForm, startAsDraft: true });
    expect(onMenu.isDraft).toBe(false);
    expect(onMenu.body).toEqual({ ...before, isDraft: false });
  });

  it("every nested line field is still sent (except QUID)", () => {
    const { body } = buildRecipeUpdatePayload(recipeForm, { isDraft: false });
    expect(Object.keys(body.ingredients[1]).sort()).toEqual(
      ["includeInFillingMix", "ingredientId", "isTopping", "marinadeAddAtCooking", "marinadeForIngredientId", "mixingOverage", "quantity", "showInPrep"],
    );
  });
});

describe("sub-recipe payload is the form values, as before", () => {
  it("passes every field through", () => {
    const subForm = {
      name: "Tomato Sauce", description: "", yield: 4.2, yieldPercent: "" as const, yieldUnit: "kg", notes: "", shelfLifeDays: 3,
      isBase: true, expandInPrep: false, madeOnProductionDay: false, labelDeclaration: "Tomato Sauce",
      ingredients: [{ ingredientId: 1, quantity: 4, hideFromPrep: false, marinadeForIngredientId: null, marinadeAddAtCooking: false }],
      subRecipeComponents: [{ componentSubRecipeId: 5, quantity: 0.2, marinadeForIngredientId: 1, marinadeAddAtCooking: true }],
    };
    expect(buildSubRecipePayload(subForm)).toEqual(subForm);
    expect(JSON.stringify(buildSubRecipePayload(subForm))).toBe(JSON.stringify(subForm));
  });
});

describe("line costs", () => {
  it("recipe ingredient: cooked qty ÷ ratio, per portion", () => {
    expect(recipeIngredientLineCost(0.1, { processingRatio: 0.5, packWeight: 1, costPerPack: 10 }, 2)).toBeCloseTo(1);
    expect(recipeIngredientLineCost(0.1, { processingRatio: 1, packWeight: 0, costPerPack: 10 }, 1)).toBeNull();
    expect(recipeIngredientLineCost(0, { packWeight: 1, costPerPack: 10 }, 1)).toBeNull();
  });
  it("sub-recipe in a recipe: qty × cost per yield unit, per portion", () => {
    expect(recipeSubRecipeLineCost(0.2, { costPerYieldUnit: 5 }, 2)).toBeCloseTo(0.5);
  });
  it("sub-recipe ingredient: raw qty, per batch", () => {
    expect(subRecipeIngredientLineCost(2, { packWeight: 4, costPerPack: 10 })).toBeCloseTo(5);
    expect(subRecipeIngredientLineCost(2, { packWeight: 4, costPerPack: 0 })).toBeNull();
  });
  it("shows pennies rounded up, or a dash", () => {
    expect(formatLineCost(0.121)).toBe("£0.13");
    expect(formatLineCost(0.13)).toBe("£0.13");
    expect(formatLineCost(null)).toBe("—");
  });
});
