/**
 * An ingredient that shares its name with one of our own sub-recipes
 * (Graeme, 19 Nov 2026: "Garlic Confit" ingredient #166 was picked in the
 * beef sub-recipe in place of the Garlic Confit sub-recipe, so the line said
 * "No UPF class" while the sub-recipe itself is UPF-free). The ingredient
 * row offers to swap to the sub-recipe, whose UPF class, cost and allergens
 * come from what's actually in it.
 */
export function normaliseItemName(name: string): string {
  return name.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

export function findTwinSubRecipe<T extends { id: number; name: string }>(ingredientName: string, subRecipes: T[]): T | null {
  const key = normaliseItemName(ingredientName);
  if (!key) return null;
  return subRecipes.find(s => normaliseItemName(s.name) === key) ?? null;
}

/** The sub-recipe row that replaces the ingredient row: same quantity, and
 *  any field both rows carry (e.g. "Marinade for", "add at cooking"). */
export function swapRowToSubRecipe(
  ingredientRow: Record<string, unknown>,
  freshSubRow: Record<string, unknown>,
  idField: string,
  subRecipeId: number,
  ingredientIdField: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...freshSubRow };
  for (const k of Object.keys(freshSubRow)) {
    if (k !== idField && k !== ingredientIdField && k in ingredientRow) out[k] = ingredientRow[k];
  }
  out[idField] = subRecipeId;
  return out;
}

/** Only swap when the quantity means the same thing (both in kg, say). */
export function sameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}
