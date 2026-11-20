/**
 * Which recipes carry an ingredient's station warning (Fix queue #404, Dave
 * Bewsey; Graeme approved 20 Nov 2026). Objective D.
 *
 * A manager writes a warning on an ingredient ("Please be vigilant for
 * bones…"). Every recipe that uses that ingredient shows it on the Mixing
 * and Building screens — whether the ingredient is in the recipe directly,
 * is a meat or marinade on it, or sits inside a sub-recipe (however deep).
 * Nothing here names a product: the warning follows the ingredient.
 *
 * Pure — the route (routes/ingredient-station-warnings.ts) does the reads.
 */

export const STATION_WARNING_MAX = 500;

export interface StationWarning {
  ingredientId: number;
  ingredientName: string;
  warning: string;
}

/** What gets stored: trimmed, blank = no warning (null). */
export function cleanStationWarning(text: string | null | undefined): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, STATION_WARNING_MAX) : null;
}

export interface WarningLinks {
  ingredients: Array<{ id: number; name: string; stationWarning: string | null }>;
  recipeIngredients: Array<{ recipeId: number; ingredientId: number }>;
  recipeSubRecipes: Array<{ recipeId: number; subRecipeId: number }>;
  recipeMeatMarinades: Array<{ recipeId: number; rawMeatIngredientId: number; marinadeIngredientId: number | null; marinadeSubRecipeId: number | null }>;
  subRecipeIngredients: Array<{ subRecipeId: number; ingredientId: number }>;
  subRecipeSubRecipes: Array<{ subRecipeId: number; componentSubRecipeId: number }>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

/**
 * recipeId → the warnings its ingredients carry, sorted by ingredient name.
 * Recipes with no warning are left out.
 */
export function warningsByRecipe(links: WarningLinks): Record<number, StationWarning[]> {
  const warned = new Map<number, StationWarning>();
  for (const i of links.ingredients) {
    const warning = cleanStationWarning(i.stationWarning);
    if (warning) warned.set(i.id, { ingredientId: i.id, ingredientName: i.name, warning });
  }
  if (warned.size === 0) return {};

  const subIngredients = new Map<number, number[]>();
  for (const r of links.subRecipeIngredients) push(subIngredients, r.subRecipeId, r.ingredientId);
  const subChildren = new Map<number, number[]>();
  for (const r of links.subRecipeSubRecipes) push(subChildren, r.subRecipeId, r.componentSubRecipeId);

  // Every ingredient inside a sub-recipe, following nested sub-recipes. The
  // `seen` set stops a sub-recipe that (wrongly) contains itself looping.
  const insideSub = (subRecipeId: number, seen: Set<number>, out: Set<number>) => {
    if (seen.has(subRecipeId)) return;
    seen.add(subRecipeId);
    for (const id of subIngredients.get(subRecipeId) ?? []) out.add(id);
    for (const child of subChildren.get(subRecipeId) ?? []) insideSub(child, seen, out);
  };

  const recipeIngredientIds = new Map<number, Set<number>>();
  const idsFor = (recipeId: number) => {
    let s = recipeIngredientIds.get(recipeId);
    if (!s) { s = new Set(); recipeIngredientIds.set(recipeId, s); }
    return s;
  };
  for (const r of links.recipeIngredients) idsFor(r.recipeId).add(r.ingredientId);
  for (const r of links.recipeSubRecipes) insideSub(r.subRecipeId, new Set(), idsFor(r.recipeId));
  for (const r of links.recipeMeatMarinades) {
    const ids = idsFor(r.recipeId);
    ids.add(r.rawMeatIngredientId);
    if (r.marinadeIngredientId != null) ids.add(r.marinadeIngredientId);
    if (r.marinadeSubRecipeId != null) insideSub(r.marinadeSubRecipeId, new Set(), ids);
  }

  const out: Record<number, StationWarning[]> = {};
  for (const [recipeId, ids] of recipeIngredientIds) {
    const list = [...ids].map(id => warned.get(id)).filter((w): w is StationWarning => !!w)
      .sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));
    if (list.length) out[recipeId] = list;
  }
  return out;
}
