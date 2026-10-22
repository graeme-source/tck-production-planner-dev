import { describe, it, expect } from "vitest";
import { planWebsiteSync, websiteUpfPercent, recipeFigures, type RecipeFacts, type ProductLink, type LedgerEntry } from "./upf-shopify-plan";

const recipe = (recipeId: number, over: Partial<RecipeFacts> = {}): RecipeFacts => ({
  recipeId, name: `Recipe ${recipeId}`,
  upfPercent: 0, unclassifiedIngredients: [],
  kcalPerPortion: 512.4, proteinPerPortion: 24.36,
  missingKcal: [], missingProtein: [],
  ...over,
});
const link = (productGid: string, recipeId: number): ProductLink => ({ productGid, productTitle: productGid, recipeId });
const ledger = (productGid: string, upf: number | null, kcal: number | null = 512, protein: number | null = 24.4): LedgerEntry =>
  ({ productGid, productTitle: productGid, published: { upf, kcal, protein } });

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
    const [d] = planWebsiteSync([recipe(1, { upfPercent: 1.2 })], [link("p1", 1)], [ledger("p1", 3.8)]);
    expect(d.metrics.upf.needsWrite).toBe(true);
    expect(d.metrics.kcal.needsWrite).toBe(false);
    expect(d.metrics.protein.needsWrite).toBe(false);
  });

  it("removes the figures from a product that is no longer linked", () => {
    const [d] = planWebsiteSync([], [], [ledger("old", 12)]);
    expect(d.status).toBe("unlinked");
    expect(d.metrics.upf).toMatchObject({ value: null, needsWrite: true });
    expect(d.metrics.kcal).toMatchObject({ value: null, needsWrite: true });
  });

  it("leaves an already-cleared unlinked product alone", () => {
    const [d] = planWebsiteSync([], [], [ledger("old", null, null, null)]);
    expect(Object.values(d.metrics).some(m => m.needsWrite)).toBe(false);
  });
});
