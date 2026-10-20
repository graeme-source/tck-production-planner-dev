/**
 * Link a Shopify product to its recipe by name (Objective G — surveys built
 * from a collection).
 *
 * Graeme, 2026-10-20: a survey built from the Properoni collection left most
 * questions on "No recipe" — the shop titles carry dashes, emojis and their
 * own capitals ("Properoni - CarniZone 🍗🍖🌶") while the recipe is
 * "Properoni Carnizone", and the old rule wanted an exact match.
 *
 * Names are compared with case, accents, emojis and punctuation removed and
 * "&" read as "and". A leading "The" is ignored when that's the only
 * difference, and so is word order ("Chorizo Chilli" on the shop, "Chilli
 * Chorizo" in the recipe). A name that fits more than one recipe links to none, rather
 * than guessing; the active recipe wins over an archived one of the same name.
 */

export function recipeNameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // accents
    .toLowerCase()
    .replace(/['\p{Pi}\p{Pf}]/gu, "") // apostrophes, curly or straight
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function withoutThe(key: string): string {
  return key.startsWith("the ") ? key.slice(4) : key;
}

/** The same words in any order. */
function wordSet(key: string): string {
  return withoutThe(key).split(" ").sort().join(" ");
}

export type MatchableRecipe = { id: number; name: string; archivedAt?: Date | string | null };

export function buildRecipeMatcher(recipes: readonly MatchableRecipe[]): (productTitle: string) => number | null {
  const index = (keyOf: (r: MatchableRecipe) => string) => {
    const map = new Map<string, MatchableRecipe[]>();
    for (const r of recipes) {
      const k = keyOf(r);
      if (!k) continue;
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return map;
  };
  const exact = index(r => recipeNameKey(r.name));
  const loose = index(r => withoutThe(recipeNameKey(r.name)));
  const anyOrder = index(r => wordSet(recipeNameKey(r.name)));

  const pick = (list: MatchableRecipe[] | undefined): number | null => {
    if (!list?.length) return null;
    if (list.length === 1) return list[0].id;
    const live = list.filter(r => !r.archivedAt);
    return live.length === 1 ? live[0].id : null;
  };

  return (productTitle: string) => {
    const key = recipeNameKey(productTitle);
    if (!key) return null;
    return pick(exact.get(key)) ?? pick(loose.get(withoutThe(key))) ?? pick(anyOrder.get(wordSet(key)));
  };
}

/**
 * Pure part of the image lookup: for each recipe name, the first shop
 * product (in row order) whose title matches it, compared with case, emojis
 * and punctuation ignored (recipeNameKey) — so "Properoni - CarniZone 🍗🍖🌶"
 * on the shop gives "Properoni Carnizone" its photo (Graeme, 2026-10-20).
 * Keyed by the LOWERCASED trimmed recipe name; misses are simply absent.
 */
export function pickRecipeImages(
  names: string[],
  rows: Array<{ productTitle: string | null; imageUrl: string | null }>,
): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const row of rows) {
    if (!row.productTitle || !row.imageUrl) continue;
    const key = recipeNameKey(row.productTitle);
    // First variant with an image wins; later rows don't overwrite.
    if (key && !byKey.has(key)) byKey.set(key, row.imageUrl);
  }
  const map = new Map<string, string>();
  for (const name of names) {
    const url = byKey.get(recipeNameKey(name));
    if (url) map.set(name.trim().toLowerCase(), url);
  }
  return map;
}
