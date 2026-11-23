import { describe, expect, it } from "vitest";
import { cleanStationWarning, warningsByRecipe, STATION_WARNING_MAX, type WarningLinks } from "./ingredient-station-warnings";

// Fix queue #404: a "watch for bones" warning written on one ingredient must
// reach every recipe that uses it, and no recipe that doesn't.
const BONES = "Please be vigilant for bones.";
const base = (): WarningLinks => ({
  ingredients: [
    { id: 1, name: "Shredded bird", stationWarning: BONES },
    { id: 2, name: "Cheese", stationWarning: null },
    { id: 3, name: "Stock", stationWarning: "  " },
  ],
  recipeIngredients: [],
  recipeSubRecipes: [],
  recipeMeatMarinades: [],
  subRecipeIngredients: [],
  subRecipeSubRecipes: [],
});

describe("cleanStationWarning", () => {
  it("treats blank as no warning", () => {
    expect(cleanStationWarning(null)).toBeNull();
    expect(cleanStationWarning("   \n ")).toBeNull();
  });
  it("trims, flattens whitespace and caps the length", () => {
    expect(cleanStationWarning("  watch\n for   bones ")).toBe("watch for bones");
    expect(cleanStationWarning("x".repeat(STATION_WARNING_MAX + 50))).toHaveLength(STATION_WARNING_MAX);
  });
});

describe("warningsByRecipe", () => {
  it("warns on a recipe that uses the ingredient directly, and only that recipe", () => {
    const links = base();
    links.recipeIngredients = [{ recipeId: 8, ingredientId: 1 }, { recipeId: 8, ingredientId: 2 }, { recipeId: 9, ingredientId: 2 }];
    expect(warningsByRecipe(links)).toEqual({ 8: [{ ingredientId: 1, ingredientName: "Shredded bird", warning: BONES }] });
  });

  it("follows the ingredient through nested sub-recipes", () => {
    const links = base();
    links.recipeSubRecipes = [{ recipeId: 5, subRecipeId: 10 }];
    links.subRecipeSubRecipes = [{ subRecipeId: 10, componentSubRecipeId: 11 }];
    links.subRecipeIngredients = [{ subRecipeId: 11, ingredientId: 1 }];
    expect(Object.keys(warningsByRecipe(links))).toEqual(["5"]);
  });

  it("counts a raw meat or a marinade on the recipe", () => {
    const links = base();
    links.recipeMeatMarinades = [
      { recipeId: 6, rawMeatIngredientId: 1, marinadeIngredientId: 2, marinadeSubRecipeId: null },
      { recipeId: 7, rawMeatIngredientId: 2, marinadeIngredientId: null, marinadeSubRecipeId: 11 },
    ];
    links.subRecipeIngredients = [{ subRecipeId: 11, ingredientId: 1 }];
    expect(Object.keys(warningsByRecipe(links)).sort()).toEqual(["6", "7"]);
  });

  it("shows each warning once even when the ingredient appears twice", () => {
    const links = base();
    links.recipeIngredients = [{ recipeId: 8, ingredientId: 1 }];
    links.recipeSubRecipes = [{ recipeId: 8, subRecipeId: 10 }];
    links.subRecipeIngredients = [{ subRecipeId: 10, ingredientId: 1 }];
    expect(warningsByRecipe(links)[8]).toHaveLength(1);
  });

  it("does not loop on a sub-recipe that contains itself", () => {
    const links = base();
    links.recipeSubRecipes = [{ recipeId: 5, subRecipeId: 10 }];
    links.subRecipeSubRecipes = [{ subRecipeId: 10, componentSubRecipeId: 10 }];
    links.subRecipeIngredients = [{ subRecipeId: 10, ingredientId: 1 }];
    expect(warningsByRecipe(links)[5]).toHaveLength(1);
  });

  it("returns nothing when no ingredient has a warning", () => {
    const links = base();
    links.ingredients[0]!.stationWarning = null;
    links.recipeIngredients = [{ recipeId: 8, ingredientId: 1 }];
    expect(warningsByRecipe(links)).toEqual({});
  });
});
