import { describe, it, expect } from "vitest";
import { normaliseForSearch, searchItems, type SearchableItem } from "./defect-item-search";

// Names are test data.
const items: SearchableItem[] = [
  { kind: "ingredient", name: "Grated Monterey Jack Cheese" },
  { kind: "sub_recipe", name: "Nacho Cheese Block v4" },
  { kind: "ingredient", name: "Extra Mature Cheddar" },
  { kind: "product", name: "Mac & Cheese" },
  { kind: "product", name: "Cheesy Garlic Bread" },
  { kind: "ingredient", name: "Crème fraîche" },
];

describe("searchItems", () => {
  it("returns nothing until something is typed", () => {
    expect(searchItems(items, "   ")).toEqual([]);
  });

  it("needs every word typed, in any order", () => {
    expect(searchItems(items, "nacho chee").map(i => i.name)).toEqual(["Nacho Cheese Block v4"]);
    expect(searchItems(items, "cheese nacho").map(i => i.name)).toEqual(["Nacho Cheese Block v4"]);
    expect(searchItems(items, "nacho sauce")).toEqual([]);
  });

  it("puts name-starts-with first, then word starts, then anywhere; products first on a tie", () => {
    expect(searchItems(items, "chee").map(i => i.name)).toEqual([
      "Cheesy Garlic Bread",          // starts with
      "Mac & Cheese",                 // a word starts with — product
      "Nacho Cheese Block v4",        // — sub-recipe
      "Grated Monterey Jack Cheese",  // — ingredient
    ]);
  });

  it("ignores case, accents and punctuation", () => {
    expect(searchItems(items, "creme FRAICHE").map(i => i.name)).toEqual(["Crème fraîche"]);
    expect(searchItems(items, "mac cheese").map(i => i.name)).toEqual(["Mac & Cheese"]);
    expect(normaliseForSearch("  Mac & Cheese! ")).toBe("mac cheese");
  });

  it("caps the list", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ kind: "ingredient" as const, name: `Salt ${i}` }));
    expect(searchItems(many, "salt", 10)).toHaveLength(10);
  });
});
