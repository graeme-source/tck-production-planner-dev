/**
 * Type-to-find for recipe pickers (Objective G — the survey builder).
 *
 * Graeme, 2026-10-20: the survey question's recipe dropdown couldn't be
 * scrolled on the iPad, so recipes further down the list were unreachable —
 * "I should just be able to search, and it should show me results based on
 * a string."
 *
 * Every word typed must appear somewhere in the recipe's name or category,
 * in any order, ignoring case, accents and punctuation ("prop carn" finds
 * "Properoni Carnizone"; "mac cheese" finds both macaroni recipes).
 */

export function normaliseSearchText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // accents
    .toLowerCase()
    .replace(/['\p{Pi}\p{Pf}]/gu, "") // apostrophes, curly or straight
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchesRecipeSearch(
  recipe: { name: string; category?: string | null },
  query: string,
): boolean {
  const words = normaliseSearchText(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normaliseSearchText(`${recipe.name} ${recipe.category ?? ""}`);
  return words.every(w => haystack.includes(w));
}

export function filterRecipeOptions<T extends { name: string; category?: string | null }>(
  recipes: readonly T[],
  query: string,
): T[] {
  return recipes.filter(r => matchesRecipeSearch(r, query));
}
