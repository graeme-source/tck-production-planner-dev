import { describe, expect, it } from "vitest";
import { mainMixDoughIds } from "./dough-mix-split";

describe("main dough mix (Graeme, 2026-10-19: bun + calzone dough were one list)", () => {
  const links = [
    { subRecipeId: 1, madeOnProductionDay: false }, // Calzone Dough
    { subRecipeId: 60, madeOnProductionDay: true },  // Bun Dough
    { subRecipeId: 1, madeOnProductionDay: false },
  ];
  it("keeps bun dough out of the calzone mixes", () => {
    expect(mainMixDoughIds([1, 60], links)).toEqual([1]);
  });
  it("leaves a plan with only calzone dough unchanged", () => {
    expect(mainMixDoughIds([1], links)).toEqual([1]);
  });
  it("treats a missing flag as an ordinary dough", () => {
    expect(mainMixDoughIds([5], [{ subRecipeId: 5, madeOnProductionDay: null }])).toEqual([5]);
  });
});
