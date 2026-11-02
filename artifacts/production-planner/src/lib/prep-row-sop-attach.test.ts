// Regression (Fix queue #362): Main Prep skipped "+ SOP" on sub-recipe rows,
// so a base or marinade on the prep list could never carry its how-to. A
// sub-recipe row must attach to the 'sub_recipe' target, keyed by its own id.
import { describe, expect, it } from "vitest";
import { prepRowSopAttachTargets } from "./prep-row-sop-attach";

const recipes = [
  { recipeId: 10, recipeName: "The Don" },
  { recipeId: 11, recipeName: "Philly" },
  { recipeId: 10, recipeName: "The Don" },
];

describe("prepRowSopAttachTargets", () => {
  it("gives a sub-recipe row a single 'sub_recipe' target keyed by the sub-recipe id", () => {
    const targets = prepRowSopAttachTargets({ ingredientId: 68, ingredientName: "Philly beef", isSubRecipe: true, recipes }, "main_prep");
    expect(targets).toEqual([
      { targetType: "sub_recipe", a: 68, text: "main_prep", label: "Philly beef", station: "main_prep" },
    ]);
    expect(targets.some(t => t.targetType === "ingredient" || t.targetType === "recipe_ingredient")).toBe(false);
  });

  it("keeps ingredient rows on Everywhere plus one target per distinct recipe", () => {
    const targets = prepRowSopAttachTargets({ ingredientId: 68, ingredientName: "Onion", recipes }, "main_prep");
    expect(targets).toEqual([
      { targetType: "ingredient", a: 68, text: "main_prep", label: "Everywhere", subject: "Onion" },
      { targetType: "recipe_ingredient", a: 10, b: 68, text: "main_prep", label: "Only The Don" },
      { targetType: "recipe_ingredient", a: 11, b: 68, text: "main_prep", label: "Only Philly" },
    ]);
  });
});
