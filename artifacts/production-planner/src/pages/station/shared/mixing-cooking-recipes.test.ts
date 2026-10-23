import { describe, expect, it } from "vitest";
import { MAC_CHEESE_CATEGORY } from "./constants";
import { mixingCookingRecipes } from "./mixing-cooking-recipes";

describe("mixingCookingRecipes", () => {
  // Regression (Fix queue #205): pigs in blankets — a Mac & Cheese cook temp
  // recorded on the Macaroni Cheese station — flashed up on Mixing's cook
  // temps for the first few seconds because the first load wasn't filtered.
  it("leaves Mac & Cheese recipes off the Mixing cook temps", () => {
    const recipes = [
      { recipeId: 1, recipeCategory: "Calzones" },
      { recipeId: 2, recipeCategory: MAC_CHEESE_CATEGORY },
      { recipeId: 3, recipeCategory: null },
    ];
    expect(mixingCookingRecipes(recipes).map(r => r.recipeId)).toEqual([1, 3]);
  });

  it("copes with a missing list", () => {
    expect(mixingCookingRecipes(undefined)).toEqual([]);
    expect(mixingCookingRecipes(null)).toEqual([]);
  });
});
