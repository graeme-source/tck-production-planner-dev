import { describe, it, expect } from "vitest";
import { filterAddItemIngredients } from "./add-item-filter";

// Names are test data.
const items = [
  { id: 1, name: "Red Onions" },
  { id: 2, name: "White Onions" },
  { id: 3, name: "Spring  Onion" },
  { id: 4, name: "Mozzarella Block" },
  { id: 5, name: null },
];

describe("filterAddItemIngredients", () => {
  it("returns the whole list, in order, when nothing is typed", () => {
    expect(filterAddItemIngredients(items, "")).toEqual(items);
    expect(filterAddItemIngredients(items, "   ")).toEqual(items);
    expect(filterAddItemIngredients(items, undefined)).toEqual(items);
  });

  it("matches the name case-insensitively", () => {
    expect(filterAddItemIngredients(items, "MOZZ").map(i => i.id)).toEqual([4]);
    expect(filterAddItemIngredients(items, "onion").map(i => i.id)).toEqual([1, 2, 3]);
  });

  it("ignores extra, leading and trailing spaces", () => {
    expect(filterAddItemIngredients(items, "  red    onion  ").map(i => i.id)).toEqual([1]);
    expect(filterAddItemIngredients(items, "spring onion").map(i => i.id)).toEqual([3]);
  });

  it("needs every word, in any order", () => {
    expect(filterAddItemIngredients(items, "onion white").map(i => i.id)).toEqual([2]);
    expect(filterAddItemIngredients(items, "onion block")).toEqual([]);
  });

  it("does not crash on a missing name and does not mutate the input", () => {
    const copy = [...items];
    filterAddItemIngredients(items, "x");
    expect(items).toEqual(copy);
  });
});
