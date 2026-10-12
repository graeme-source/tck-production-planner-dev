/**
 * Line costs shown beside each row in the recipe and sub-recipe editors.
 * The two editors share the rows (components/recipe-editor) but cost a line
 * differently, because the quantities mean different things:
 *
 *   • Final product (recipe): quantities are COOKED amounts for the
 *     recipe's output, so the raw amount bought is qty ÷ processing ratio,
 *     and the cost is per portion (÷ servings).
 *   • Sub-recipe: quantities are the raw amounts that go into one batch, so
 *     the cost is simply qty ÷ pack weight × pack cost, per batch.
 *   • A sub-recipe used inside a recipe: qty × cost per yield unit, per
 *     portion.
 *
 * Every line cost is shown rounded UP to the penny (never under-states).
 * Pure — unit-tested.
 */

export function recipeIngredientLineCost(
  quantity: unknown,
  ing: { processingRatio?: number | null; packWeight?: number | null; costPerPack?: number | null } | undefined,
  servings: unknown,
): number | null {
  const qty = Number(quantity);
  if (!ing || !qty) return null;
  const pw = Number(ing.packWeight) || 0;
  if (pw === 0) return null;
  const pr = Number(ing.processingRatio) || 1;
  const s = Number(servings) || 1;
  return ((qty / pr) * (Number(ing.costPerPack) || 0) / pw) / s;
}

export function recipeSubRecipeLineCost(
  quantity: unknown,
  sub: { costPerYieldUnit?: number | null } | undefined,
  servings: unknown,
): number | null {
  const qty = Number(quantity);
  if (!sub || !qty) return null;
  const s = Number(servings) || 1;
  return (qty * (Number(sub.costPerYieldUnit) || 0)) / s;
}

export function subRecipeIngredientLineCost(
  quantity: unknown,
  ing: { packWeight?: number | null; costPerPack?: number | null } | undefined,
): number | null {
  const qty = Number(quantity) || 0;
  const cpp = Number(ing?.costPerPack) || 0;
  const pw = Number(ing?.packWeight) || 0;
  if (!(qty > 0) || !(cpp > 0) || !(pw > 0)) return null;
  return (qty / pw) * cpp;
}

/** "£0.13" (rounded up to the penny) or "—". */
export function formatLineCost(cost: number | null): string {
  if (cost == null || !Number.isFinite(cost)) return "—";
  return `£${(Math.ceil(cost * 100 - 1e-9) / 100).toFixed(2)}`;
}
