import { describe, it, expect } from "vitest";
import { planUpfSync, websiteUpfPercent, type RecipeUpfInput, type ProductLink } from "./upf-shopify-plan";

const recipe = (recipeId: number, upfPercent: number | null, unclassified: string[] = []): RecipeUpfInput =>
  ({ recipeId, name: `Recipe ${recipeId}`, upfPercent, unclassifiedIngredients: unclassified });
const link = (productGid: string, recipeId: number): ProductLink => ({ productGid, productTitle: productGid, recipeId });

describe("websiteUpfPercent", () => {
  it("keeps 0 as UPF free", () => expect(websiteUpfPercent(0)).toBe(0));
  it("rounds to one decimal place", () => expect(websiteUpfPercent(12.345)).toBe(12.3));
  it("never rounds a trace of UPF down to free", () => expect(websiteUpfPercent(0.02)).toBe(0.1));
});

describe("planUpfSync", () => {
  it("publishes a fully classified recipe's percentage", () => {
    const [d] = planUpfSync([recipe(1, 3.84)], [link("p1", 1)], []);
    expect(d).toMatchObject({ status: "published", percent: 3.8, needsWrite: true });
  });

  it("publishes UPF-free as 0", () => {
    const [d] = planUpfSync([recipe(1, 0)], [link("p1", 1)], []);
    expect(d).toMatchObject({ status: "published", percent: 0 });
  });

  it("holds back a recipe with unclassified ingredients — the website shows nothing", () => {
    const [d] = planUpfSync([recipe(1, 4, ["Turmeric"])], [link("p1", 1)], [{ productGid: "p1", productTitle: "p1", publishedPercent: 4 }]);
    expect(d).toMatchObject({ status: "held_unclassified", percent: null, unclassified: ["Turmeric"], needsWrite: true });
  });

  it("holds back a product linked to several recipes", () => {
    const [d] = planUpfSync([recipe(1, 0), recipe(2, 10)], [link("p1", 1), link("p1", 2)], []);
    expect(d).toMatchObject({ status: "held_several_recipes", percent: null });
  });

  it("treats two variants of the same recipe on one product as one recipe", () => {
    const [d] = planUpfSync([recipe(1, 0)], [link("p1", 1), link("p1", 1)], []);
    expect(d.status).toBe("published");
  });

  it("only writes when the number changed", () => {
    const ledger = [{ productGid: "p1", productTitle: "p1", publishedPercent: 3.8 }];
    expect(planUpfSync([recipe(1, 3.84)], [link("p1", 1)], ledger)[0].needsWrite).toBe(false);
    expect(planUpfSync([recipe(1, 1.2)], [link("p1", 1)], ledger)[0].needsWrite).toBe(true);
  });

  it("removes the number from a product that is no longer linked", () => {
    const ledger = [{ productGid: "old", productTitle: "Old", publishedPercent: 12 }];
    const [d] = planUpfSync([], [], ledger);
    expect(d).toMatchObject({ productGid: "old", status: "unlinked", percent: null, needsWrite: true });
  });

  it("leaves an already-cleared unlinked product alone", () => {
    const ledger = [{ productGid: "old", productTitle: "Old", publishedPercent: null }];
    expect(planUpfSync([], [], ledger)[0].needsWrite).toBe(false);
  });
});
