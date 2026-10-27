/**
 * How much of each PREP ITEM one batch of a recipe uses — so measured prep
 * rates (minutes per kg, lib/prep-timing.ts) become prep minutes per batch
 * (Graeme, 27 Oct 2026; Objectives C and I). Pure; services/prep-times-
 * report.ts loads the rows.
 *
 * A prep item is what a prep screen opens and ticks: an ingredient, or a
 * sub-recipe made as a whole (Garlic Butter, Tomato Base, a rub, the dough).
 * A shared item allocates by usage — Tomato Base made once for every recipe
 * costs each recipe its kilos × the Tomato Base rate.
 *
 * Quantities are in the basis the prep screens show, so they match what the
 * sessions measured (the same rules as Main Prep's /main-prep and the Raw
 * Meat station's /prep-requirements-by-recipe):
 *   - recipe quantities are per portion; one batch is portions_per_batch;
 *   - ingredient lines are prepped RAW (cooked ÷ processing ratio) unless
 *     the ingredient preps by processed weight; a prep count per portion
 *     makes it pieces;
 *   - a sub-recipe line is the sub-recipe in its yield unit; an "expand in
 *     prep" sub-recipe is its ingredients (and nested sub-recipes) instead,
 *     scaled by its yield, as Main Prep lists them;
 *   - raw meat inside a sub-recipe that isn't expanded is still prepped for
 *     the recipe on the Raw Meat station, so it counts too (raw).
 * Left out, as on the screens: toppings, a recipe's marinade INGREDIENT lines
 * (they go on with the meat, timed in the meat's trays), components hidden
 * from prep, and lines the caller says aren't prepped (notPrepped).
 * Weights and volumes come back in grams (@workspace/units, 1 g/ml); counts
 * stay counts with their unit.
 */
import { cookedToRaw, gramsOrNull } from "@workspace/units";

export type PrepItemKind = "ingredient" | "sub_recipe";

export function prepItemKey(kind: PrepItemKind, id: number): string {
  return `${kind}:${id}`;
}

export interface UsageIngredient {
  id: number;
  name: string;
  unit: string;
  category: string | null;
  processingRatio: number | null;
  prepWeightMode: string | null;
  prepCountPerPortion: number | null;
}

export interface UsageSubRecipe {
  id: number;
  name: string;
  yield: number;
  yieldUnit: string;
  expandInPrep: boolean;
  ingredients: Array<{ ingredientId: number; quantity: number; hideFromPrep: boolean; marinadeForIngredientId: number | null }>;
  subRecipes: Array<{ subRecipeId: number; quantity: number; marinadeForIngredientId: number | null }>;
}

export interface UsageRecipe {
  id: number;
  portionsPerBatch: number;
  ingredients: Array<{ ingredientId: number; quantity: number; isTopping: boolean; marinadeForIngredientId: number | null; includeInFillingMix: boolean }>;
  subRecipes: Array<{ subRecipeId: number; quantity: number; isTopping: boolean; marinadeForIngredientId: number | null }>;
}

export interface PrepUsage {
  itemKey: string;
  kind: PrepItemKind;
  id: number;
  /** Grams per batch when the item is weighed (or measured by volume). */
  grams: number | null;
  /** Count per batch when the item is counted (pieces, each…). */
  count: number | null;
  countUnit: string | null;
}

export interface UsageRules {
  /** A direct ingredient line no prep screen shows (e.g. topping cheese
   *  that goes straight to the building fridges). */
  notPrepped?: (ingredient: UsageIngredient, line: { includeInFillingMix: boolean }) => boolean;
  /** An ingredient the Raw Meat station preps for the recipe even when it
   *  sits inside a sub-recipe. */
  preppedWithMeat?: (ingredient: UsageIngredient) => boolean;
}

const DEFAULT_PORTIONS = 10;

/** Normalised count unit ("Pieces" → "pieces"). */
export function countUnitOf(unit: string | null | undefined): string {
  return (unit ?? "each").trim().toLowerCase() || "each";
}

export function prepUsagePerBatch(
  recipe: UsageRecipe,
  ingredients: ReadonlyMap<number, UsageIngredient>,
  subRecipes: ReadonlyMap<number, UsageSubRecipe>,
  rules: UsageRules = {},
): PrepUsage[] {
  const portions = Number(recipe.portionsPerBatch) > 0 ? Number(recipe.portionsPerBatch) : DEFAULT_PORTIONS;
  const out = new Map<string, PrepUsage>();

  const add = (kind: PrepItemKind, id: number, qty: number, unit: string) => {
    if (!(qty > 0) || !Number.isFinite(qty)) return;
    const key = prepItemKey(kind, id);
    const row = out.get(key) ?? { itemKey: key, kind, id, grams: null, count: null, countUnit: null };
    const g = gramsOrNull(qty, unit);
    if (g != null) {
      row.grams = (row.grams ?? 0) + g;
    } else {
      const cu = countUnitOf(unit);
      if (row.countUnit == null || row.countUnit === cu) {
        row.count = (row.count ?? 0) + qty;
        row.countUnit = cu;
      }
    }
    out.set(key, row);
  };

  /** Raw (or processed, per the ingredient) prep quantity of a cooked amount. */
  const prepBasis = (ing: UsageIngredient, cooked: number) =>
    ing.prepWeightMode === "processed" ? cooked : cookedToRaw(cooked, ing.processingRatio);

  /** Raw meat inside a sub-recipe that isn't expanded, `scale` = sub-recipe
   *  amount ÷ its yield. Walks nested sub-recipes; a cycle stops the walk. */
  const meatInside = (sr: UsageSubRecipe, scale: number, path: Set<number>) => {
    if (!rules.preppedWithMeat || path.has(sr.id)) return;
    const nextPath = new Set(path).add(sr.id);
    for (const line of sr.ingredients) {
      const ing = ingredients.get(line.ingredientId);
      if (!ing || !rules.preppedWithMeat(ing)) continue;
      add("ingredient", ing.id, cookedToRaw(line.quantity * scale, ing.processingRatio), ing.unit);
    }
    for (const nested of sr.subRecipes) {
      const child = subRecipes.get(nested.subRecipeId);
      if (!child || !(child.yield > 0)) continue;
      meatInside(child, (nested.quantity * scale) / child.yield, nextPath);
    }
  };

  for (const line of recipe.ingredients) {
    if (line.isTopping || line.marinadeForIngredientId != null) continue;
    const ing = ingredients.get(line.ingredientId);
    if (!ing) continue;
    if (rules.notPrepped?.(ing, line)) continue;
    if (ing.prepCountPerPortion != null && ing.prepCountPerPortion > 0) {
      add("ingredient", ing.id, portions * ing.prepCountPerPortion, "pieces");
    } else {
      add("ingredient", ing.id, prepBasis(ing, line.quantity * portions), ing.unit);
    }
  }

  for (const line of recipe.subRecipes) {
    if (line.isTopping) continue;
    const sr = subRecipes.get(line.subRecipeId);
    if (!sr) continue;
    const amount = line.quantity * portions;
    const scale = sr.yield > 0 ? amount / sr.yield : 0;
    if (sr.expandInPrep && line.marinadeForIngredientId == null && scale > 0) {
      for (const comp of sr.ingredients) {
        if (comp.hideFromPrep || comp.marinadeForIngredientId != null) continue;
        const ing = ingredients.get(comp.ingredientId);
        if (ing) add("ingredient", ing.id, comp.quantity * scale, ing.unit);
      }
      for (const nested of sr.subRecipes) {
        if (nested.marinadeForIngredientId != null) continue;
        const child = subRecipes.get(nested.subRecipeId);
        if (child) add("sub_recipe", child.id, nested.quantity * scale, child.yieldUnit);
      }
      continue;
    }
    // Made as a whole (a rub for the meat included) — and its raw meat, if
    // any, is prepped for this recipe on the Raw Meat station.
    add("sub_recipe", sr.id, amount, sr.yieldUnit);
    if (scale > 0) meatInside(sr, scale, new Set());
  }

  return [...out.values()];
}
