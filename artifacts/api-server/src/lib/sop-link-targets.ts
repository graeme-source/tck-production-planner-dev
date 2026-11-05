/**
 * The places an SOP can be attached, and what each one needs. Pure so the
 * rules can be tested without a database. 'supplier' (Fix queue #390) has
 * a = the supplier's id: a how-to for ordering from that one supplier.
 */
export const SOP_LINK_TYPES = new Set(["checklist_template", "ingredient", "recipe_ingredient", "recipe", "sub_recipe", "station", "page", "supplier"]);

/** Link types addressed by a text key rather than a numeric id. */
export const SOP_TEXT_KEYED_LINK_TYPES = new Set(["station", "page"]);

/** Why this attach can't be saved, or null when it's fine. */
export function sopLinkProblem(link: { sopId: number; targetType: string; a: number | null; b: number | null; text: string | null }): string | null {
  if (!Number.isInteger(link.sopId) || !SOP_LINK_TYPES.has(link.targetType)) return "sopId and a valid targetType are required";
  if (SOP_TEXT_KEYED_LINK_TYPES.has(link.targetType) ? !link.text : !Number.isInteger(link.a)) return "Target reference missing";
  if (link.targetType === "recipe_ingredient" && !Number.isInteger(link.b)) return "recipe_ingredient links need a=recipeId and b=ingredientId";
  return null;
}
