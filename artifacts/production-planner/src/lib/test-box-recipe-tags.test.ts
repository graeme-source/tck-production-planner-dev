import { describe, expect, it } from "vitest";
import { addRecipesByTag, recipeTagCounts } from "./test-box-recipe-tags";

const recipes = [
  { id: 36, name: "Chicken & Tarragon Pie", tags: ["Winter Warmers Test Box"] },
  { id: 37, name: "Sausage Sage & Onion", tags: ["winter warmers test box ", "Pork"] },
  { id: 42, name: "Shredded Beef & Mushroom", tags: ["Winter Warmers Test Box"] },
  { id: 5, name: "Chicken & Chorizo", tags: [] },
];

describe("recipeTagCounts", () => {
  it("counts each tag once per recipe, ignoring case and spaces, busiest first", () => {
    expect(recipeTagCounts(recipes)).toEqual([{ tag: "Winter Warmers Test Box", count: 3 }, { tag: "Pork", count: 1 }]);
  });
});

describe("addRecipesByTag", () => {
  it("adds every tagged recipe not already in the box, in name order", () => {
    expect(addRecipesByTag([42], recipes, "Winter Warmers Test Box", 4))
      .toEqual({ ids: [42, 36, 37], added: ["Chicken & Tarragon Pie", "Sausage Sage & Onion"], left: [] });
  });
  it("stops at the box's limit and names what didn't fit", () => {
    expect(addRecipesByTag([5, 1], recipes, "winter warmers test box", 4))
      .toEqual({ ids: [5, 1, 36, 37], added: ["Chicken & Tarragon Pie", "Sausage Sage & Onion"], left: ["Shredded Beef & Mushroom"] });
  });
});
