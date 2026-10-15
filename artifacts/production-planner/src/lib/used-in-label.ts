/** "3 recipes", "3 recipes + 1 sub-recipe", "1 sub-recipe" — the text of
 *  the "Used in …" link (components/ingredient-usage-dialog.tsx). */
export function usedInLabel(recipes: number, subRecipes: number): string {
  const parts: string[] = [];
  if (recipes > 0) parts.push(`${recipes} recipe${recipes === 1 ? "" : "s"}`);
  if (subRecipes > 0) parts.push(`${subRecipes} sub-recipe${subRecipes === 1 ? "" : "s"}`);
  return parts.join(" + ");
}
