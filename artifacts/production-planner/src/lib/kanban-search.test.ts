import { describe, it, expect } from "vitest";
import { searchKanbans } from "./kanban-search";

const items = [
  { ingredientId: 1, ingredientName: "Packing Box Tape", supplierName: "Macfarlane Packaging" },
  { ingredientId: 2, ingredientName: "Large Courier Boxes", supplierName: "Macfarlane Packaging" },
  { ingredientId: 3, ingredientName: "Honey Sriracha (190g)", supplierName: "The Sauce Shop" },
  { ingredientId: 4, ingredientName: "Tomato Ketchup (490g)", supplierName: "The Sauce Shop" },
];

describe("searchKanbans", () => {
  it("finds by any words of the name, in any order", () => {
    expect(searchKanbans(items, "tape").map(i => i.ingredientId)).toEqual([1]);
    expect(searchKanbans(items, "boxes courier").map(i => i.ingredientId)).toEqual([2]);
  });
  it("finds by supplier too, names starting with the word first", () => {
    expect(searchKanbans(items, "sauce").map(i => i.ingredientId)).toEqual([3, 4]);
    expect(searchKanbans(items, "box").map(i => i.ingredientId)).toEqual([2, 1]);
    expect(searchKanbans(items, "large").map(i => i.ingredientId)).toEqual([2]);
  });
  it("shows everything, A to Z, before anything is typed", () => {
    expect(searchKanbans(items, "  ").map(i => i.ingredientId)).toEqual([3, 2, 1, 4]);
  });
});
