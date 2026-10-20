import { describe, expect, it } from "vitest";
import { buildRecipeMatcher, recipeNameKey } from "./recipe-name-match";

const recipes = [
  { id: 34, name: "Properoni Carnizone" },
  { id: 5, name: "Carnizone" },
  { id: 33, name: "Properoni Chicken & Chorizo" },
  { id: 35, name: "Properoni Chilli Chorizo & Fior Di Latte" },
  { id: 39, name: "The Christmas Dinner" },
  { id: 7, name: "Mexican Chicken", archivedAt: "2026-09-01T00:00:00Z" },
  { id: 8, name: "Mexican Chicken" },
];

describe("recipe name matching for shop products", () => {
  const match = buildRecipeMatcher(recipes);

  it("ignores dashes, emojis and capitals (the Properoni survey)", () => {
    expect(match("Properoni - CarniZone 🍗🍖🌶")).toBe(34);
    expect(match("Properoni – Chicken & Chorizo 🌶️")).toBe(33);
    expect(match("PROPERONI Chilli Chorizo and Fior di Latte")).toBe(35);
  });

  it("still matches an exact name", () => {
    expect(match("Carnizone")).toBe(5);
    expect(match("  carnizone ")).toBe(5);
  });

  it("ignores a leading The on either side", () => {
    expect(match("Christmas Dinner")).toBe(39);
    expect(match("The Carnizone")).toBe(5);
  });

  it("ignores word order (the shop's Chorizo Chilli vs the recipe's Chilli Chorizo)", () => {
    expect(match("Properoni Chorizo Chilli & Fior Di Latte")).toBe(35);
  });

  it("prefers the active recipe over an archived one with the same name", () => {
    expect(match("Mexican Chicken")).toBe(8);
  });

  it("links nothing when two live recipes fit, or nothing fits", () => {
    const m = buildRecipeMatcher([{ id: 1, name: "Pie" }, { id: 2, name: "PIE!" }]);
    expect(m("Pie")).toBeNull();
    expect(match("Gift Card")).toBeNull();
    expect(match("🍗🍖")).toBeNull();
  });

  it("does not match on part of a name", () => {
    expect(match("Properoni")).toBeNull();
  });

  it("builds a clean key", () => {
    expect(recipeNameKey("Big Nanny's Mac & Cheese 🧀")).toBe("big nannys mac and cheese");
  });
});
