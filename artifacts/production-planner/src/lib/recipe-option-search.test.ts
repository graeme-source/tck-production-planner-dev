import { describe, expect, it } from "vitest";
import { filterRecipeOptions, matchesRecipeSearch, normaliseSearchText } from "./recipe-option-search";

const recipes = [
  { name: "Properoni Carnizone", category: "Calzones" },
  { name: "Carnizone", category: "Calzones" },
  { name: "Big Nanny's Macaroni Cheese", category: "Macaroni Cheese" },
  { name: "Pigs & Blankets - Big Nanny's Macaroni Cheese", category: "Macaroni Cheese" },
  { name: "Dough ball 200g", category: null },
];

describe("recipe option search", () => {
  it("shows everything for an empty search", () => {
    expect(filterRecipeOptions(recipes, "   ")).toHaveLength(recipes.length);
  });

  it("matches part of a word, ignoring case", () => {
    expect(filterRecipeOptions(recipes, "PROPER").map(r => r.name)).toEqual(["Properoni Carnizone"]);
  });

  it("needs every word, in any order", () => {
    expect(filterRecipeOptions(recipes, "carn prop").map(r => r.name)).toEqual(["Properoni Carnizone"]);
    expect(filterRecipeOptions(recipes, "carnizone")).toHaveLength(2);
  });

  it("searches the category too", () => {
    expect(filterRecipeOptions(recipes, "macaroni")).toHaveLength(2);
    expect(matchesRecipeSearch({ name: "Cinnamon Buns", category: "Desserts" }, "dessert")).toBe(true);
  });

  it("ignores punctuation, apostrophes and & vs and", () => {
    expect(filterRecipeOptions(recipes, "nannys pigs and blankets").map(r => r.name))
      .toEqual(["Pigs & Blankets - Big Nanny's Macaroni Cheese"]);
    expect(normaliseSearchText("Fior Di Latte & Chorizo")).toBe("fior di latte and chorizo");
  });

  it("copes with a missing category", () => {
    expect(filterRecipeOptions(recipes, "dough").map(r => r.name)).toEqual(["Dough ball 200g"]);
  });
});
