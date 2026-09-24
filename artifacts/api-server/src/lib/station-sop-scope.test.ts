import { describe, it, expect } from "vitest";
import { stationsForLink, type SopScopeFacts } from "./station-sop-scope";

// Facts shaped on the real data: 4 = The Godfather, 26 = Philly (beef via a
// sub-recipe), 10 = Garlic Cheese (veg), 16 = Pigs & Blankets mac cheese;
// ingredients 306 beef mince / 22 pork / 189 pigs in blankets are raw meat.
const facts: SopScopeFacts = {
  recipeHasRawMeat: id => [4, 26, 16, 3, 5].includes(id),
  recipeIsMacCheese: id => id === 16,
  ingredientIsRawMeat: id => [306, 22, 189].includes(id),
  checklistStation: id => ({ 340: "prep", 152: "packing" } as Record<number, string>)[id] ?? null,
};
const link = (targetType: string, targetA: number | null, targetB: number | null = null, targetText: string | null = null) =>
  ({ targetType, targetA, targetB, targetText });

describe("stationsForLink", () => {
  it("the Beef Mince SOP on The Godfather shows on Raw Meat (the reported gap)", () => {
    expect(stationsForLink(link("recipe_ingredient", 4, 306), facts)).toEqual(["prep_meat"]);
  });
  it("an ingredient that isn't raw meat shows on Main Prep and Bases & Sauces", () => {
    expect(stationsForLink(link("ingredient", 999), facts)).toEqual(["main_prep", "prep_bases"]);
  });
  it("a recipe SOP pinned to one screen counts only there; 'building' is both tables", () => {
    expect(stationsForLink(link("recipe", 26, null, "mixing"), facts)).toEqual(["mixing"]);
    expect(stationsForLink(link("recipe", 26, null, "building"), facts)).toEqual(["building_1", "building_2"]);
  });
  it("an unpinned recipe SOP counts wherever the recipe appears", () => {
    expect(stationsForLink(link("recipe", 10), facts)).toEqual(["mixing", "building_1", "building_2", "wrapping"]);
    expect(stationsForLink(link("recipe", 16), facts)).toEqual(["prep_meat", "wrapping"]);
  });
  it("station and checklist SOPs go to their station", () => {
    expect(stationsForLink(link("station", null, null, "mixing"), facts)).toEqual(["mixing"]);
    expect(stationsForLink(link("checklist_template", 340), facts)).toEqual(["prep"]);
    expect(stationsForLink(link("checklist_template", 152), facts)).toEqual(["packing"]);
  });
  it("sub-recipe SOPs go to Bases & Sauces; page SOPs to no station", () => {
    expect(stationsForLink(link("sub_recipe", 68), facts)).toEqual(["prep_bases"]);
    expect(stationsForLink(link("page", null, null, "/fulfilment"), facts)).toEqual([]);
  });
});
