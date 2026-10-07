import { describe, it, expect } from "vitest";
import { allocateBagsOnHand, bagShortfall } from "./eight-pack-shortfall";

describe("bagShortfall", () => {
  it("is what's needed beyond the fridge, never negative", () => {
    expect(bagShortfall(10, 4)).toBe(6);
    expect(bagShortfall(3, 8)).toBe(0);
    expect(bagShortfall(5, 0)).toBe(5);
    expect(bagShortfall(5, -2)).toBe(5);
  });
});

describe("allocateBagsOnHand", () => {
  it("shares the fridge's bags across orders in order, not twice", () => {
    const out = allocateBagsOnHand(
      [
        { key: "a", recipeId: 7, bags: 3 },
        { key: "b", recipeId: 7, bags: 4 },
        { key: "c", recipeId: 9, bags: 2 },
      ],
      new Map([[7, 5]]),
    );
    expect(out.get("a")).toEqual({ fromFridge: 3, toMake: 0 });
    expect(out.get("b")).toEqual({ fromFridge: 2, toMake: 2 });
    expect(out.get("c")).toEqual({ fromFridge: 0, toMake: 2 });
  });
  it("does not change the caller's on-hand map", () => {
    const onHand = new Map([[7, 5]]);
    allocateBagsOnHand([{ key: "a", recipeId: 7, bags: 5 }], onHand);
    expect(onHand.get(7)).toBe(5);
  });
});
