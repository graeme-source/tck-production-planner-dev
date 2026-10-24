import { describe, it, expect } from "vitest";
import { planWebsiteSync, websiteUpfPercent, recipeFigures, nutritionPanelJson, type RecipeFacts, type ProductLink, type LedgerEntry, type NutritionValues } from "./upf-shopify-plan";

const vals = (over: Partial<NutritionValues> = {}): NutritionValues => ({
  energyKj: 1046.4, energyKcal: 250.2, fat: 9.87, saturates: 4.04, carbohydrate: 28.66,
  sugars: 3.21, fibre: 2.05, protein: 12.34, salt: 1.234, ...over,
});

const recipe = (recipeId: number, over: Partial<RecipeFacts> = {}): RecipeFacts => ({
  recipeId, name: `Recipe ${recipeId}`,
  upfPercent: 0, unclassifiedIngredients: [],
  kcalPerPortion: 512.4, proteinPerPortion: 24.36,
  missingKcal: [], missingProtein: [],
  nutrition: { portionWeightG: 205.4, per100g: vals(), perPortion: vals() },
  missingNutrition: [],
  ...over,
});
const link = (productGid: string, recipeId: number): ProductLink => ({ productGid, productTitle: productGid, recipeId });
const ledger = (productGid: string, upf: number | null, kcal: number | null = 512, protein: number | null = 24.4, nutrition: string | null = null): LedgerEntry =>
  ({ productGid, productTitle: productGid, published: { upf, kcal, protein, nutrition } });

describe("websiteUpfPercent", () => {
  it("keeps 0 as UPF free", () => expect(websiteUpfPercent(0)).toBe(0));
  it("rounds to one decimal place", () => expect(websiteUpfPercent(12.345)).toBe(12.3));
  it("never rounds a trace of UPF down to free", () => expect(websiteUpfPercent(0.02)).toBe(0.1));
});

describe("recipeFigures", () => {
  it("rounds calories to whole kcal and protein to one decimal", () => {
    const f = recipeFigures(recipe(1));
    expect(f.kcal.value).toBe(512);
    expect(f.protein.value).toBe(24.4);
  });

  it("holds back UPF when an ingredient is unclassified, but still shows nutrition", () => {
    const f = recipeFigures(recipe(1, { upfPercent: 4, unclassifiedIngredients: ["Turmeric"] }));
    expect(f.upf).toEqual({ value: null, heldBecause: "not yet classified: Turmeric" });
    expect(f.kcal.value).toBe(512);
  });

  it("holds back calories when an ingredient has no kcal figure", () => {
    const f = recipeFigures(recipe(1, { missingKcal: ["Cheddar"] }));
    expect(f.kcal).toEqual({ value: null, heldBecause: "no calories on: Cheddar" });
    expect(f.protein.value).toBe(24.4);
  });

  it("holds back protein when an ingredient has no protein figure", () => {
    expect(recipeFigures(recipe(1, { missingProtein: ["Basil"] })).protein.value).toBeNull();
  });

  it("holds back nutrition when there's no portion weight", () => {
    const f = recipeFigures(recipe(1, { kcalPerPortion: null, proteinPerPortion: null }));
    expect(f.kcal.value).toBeNull();
    expect(f.protein.value).toBeNull();
  });
});

describe("planWebsiteSync", () => {
  it("publishes every figure for a complete recipe", () => {
    const [d] = planWebsiteSync([recipe(1, { upfPercent: 3.84 })], [link("p1", 1)], []);
    expect(d.status).toBe("linked");
    expect(d.metrics.upf).toMatchObject({ value: 3.8, needsWrite: true });
    expect(d.metrics.kcal).toMatchObject({ value: 512, needsWrite: true });
  });

  it("holds back everything on a product linked to several recipes", () => {
    const [d] = planWebsiteSync([recipe(1), recipe(2)], [link("p1", 1), link("p1", 2)], []);
    expect(d.status).toBe("several_recipes");
    expect(d.metrics.upf.value).toBeNull();
    expect(d.metrics.protein.value).toBeNull();
  });

  it("treats two variants of the same recipe on one product as one recipe", () => {
    expect(planWebsiteSync([recipe(1)], [link("p1", 1), link("p1", 1)], [])[0].status).toBe("linked");
  });

  it("only writes the figures that changed", () => {
    const panel = recipeFigures(recipe(1)).nutrition.value as string;
    const [d] = planWebsiteSync([recipe(1, { upfPercent: 1.2 })], [link("p1", 1)], [ledger("p1", 3.8, 512, 24.4, panel)]);
    expect(d.metrics.upf.needsWrite).toBe(true);
    expect(d.metrics.kcal.needsWrite).toBe(false);
    expect(d.metrics.protein.needsWrite).toBe(false);
    expect(d.metrics.nutrition.needsWrite).toBe(false);
  });

  it("removes the figures from a product that is no longer linked", () => {
    const [d] = planWebsiteSync([], [], [ledger("old", 12)]);
    expect(d.status).toBe("unlinked");
    expect(d.metrics.upf).toMatchObject({ value: null, needsWrite: true });
    expect(d.metrics.kcal).toMatchObject({ value: null, needsWrite: true });
  });

  it("leaves an already-cleared unlinked product alone", () => {
    const [d] = planWebsiteSync([], [], [ledger("old", null, null, null, null)]);
    expect(Object.values(d.metrics).some(m => m.needsWrite)).toBe(false);
  });
});

describe("nutrition table", () => {
  it("rounds like a label: energy whole, salt 2 dp, the rest 1 dp", () => {
    const json = nutritionPanelJson({ portionWeightG: 205.4, per100g: vals(), perPortion: vals() });
    expect(JSON.parse(json!)).toEqual({
      portionWeightG: 205,
      per100g: { energyKj: 1046, energyKcal: 250, fat: 9.9, saturates: 4, carbohydrate: 28.7, sugars: 3.2, fibre: 2.1, protein: 12.3, salt: 1.23 },
      perPortion: { energyKj: 1046, energyKcal: 250, fat: 9.9, saturates: 4, carbohydrate: 28.7, sugars: 3.2, fibre: 2.1, protein: 12.3, salt: 1.23 },
    });
  });

  it("is identical for an unchanged recipe, so nothing is rewritten", () => {
    const p = { portionWeightG: 200, per100g: vals(), perPortion: vals() };
    expect(nutritionPanelJson(p)).toBe(nutritionPanelJson({ ...p }));
  });

  it("is withheld when any value is missing", () => {
    expect(nutritionPanelJson({ portionWeightG: 200, per100g: vals({ fibre: null }), perPortion: vals() })).toBeNull();
    expect(nutritionPanelJson({ portionWeightG: 0, per100g: vals(), perPortion: vals() })).toBeNull();
  });

  it("holds back the whole table when an ingredient is missing nutrition, but not the icons", () => {
    const f = recipeFigures(recipe(1, { missingNutrition: ["Basil"] }));
    expect(f.nutrition).toEqual({ value: null, heldBecause: "missing nutrition on: Basil" });
    expect(f.kcal.value).toBe(512);
  });
});
