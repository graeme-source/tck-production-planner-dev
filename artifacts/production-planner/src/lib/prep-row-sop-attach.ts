import type { SopAttachTarget } from "@/components/sop-link-chips";

/** The bits of a prep row that decide where its "+ SOP" attaches. */
export interface PrepRowSopSubject {
  /** A real ingredient id — or, on a sub-recipe row, the sub-recipe id. */
  ingredientId: number;
  ingredientName: string;
  isSubRecipe?: boolean;
  recipes: Array<{ recipeId: number; recipeName: string }>;
}

/** Where "+ SOP" on a prep row attaches (issue #362). A sub-recipe row's id
 *  lives in the sub-recipe table, so it gets the 'sub_recipe' target — the
 *  same one Bases & Sauces uses — never an ingredient target that would
 *  collide with a real ingredient of the same id. Ingredient rows offer
 *  Everywhere or a single recipe. */
export function prepRowSopAttachTargets(ing: PrepRowSopSubject, station: string): SopAttachTarget[] {
  if (ing.isSubRecipe) {
    return [{ targetType: "sub_recipe", a: ing.ingredientId, text: station, label: ing.ingredientName, station }];
  }
  return [
    { targetType: "ingredient", a: ing.ingredientId, text: station, label: "Everywhere", subject: ing.ingredientName },
    ...[...new Map(ing.recipes.map(r => [r.recipeId, r.recipeName])).entries()].map(([recipeId, recipeName]) => ({
      targetType: "recipe_ingredient" as const,
      a: recipeId,
      b: ing.ingredientId,
      text: station,
      label: `Only ${recipeName}`,
    })),
  ];
}
