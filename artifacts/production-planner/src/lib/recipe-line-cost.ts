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

/** The recipe margin bands — same as the Recipes table's GP margin colours
 *  (green at the 80% target, amber down to the 75% floor, red below). */
export const MARGIN_TARGET_PERCENT = 80;
export const MARGIN_FLOOR_PERCENT = 75;

/**
 * Live pack cost and gross margin while the recipe is being edited — the
 * same sum as the server (routes/recipes.ts enrichWithCosts): ingredient
 * cost per portion × pack size, plus packaging and labour per pack; margin
 * against the RRP, or null with no RRP.
 */
export function livePackMargin(input: {
  costPerPortion: number;
  packSize: unknown;
  packagingCost: unknown;
  labourCost: unknown;
  rrp: unknown;
}): { packCost: number; margin: number | null } {
  const packSize = Number(input.packSize) || 1;
  const packCost = input.costPerPortion * packSize + (Number(input.packagingCost) || 0) + (Number(input.labourCost) || 0);
  const rrp = Number(input.rrp) || 0;
  return { packCost, margin: rrp > 0 ? ((rrp - packCost) / rrp) * 100 : null };
}

/** The RRP (rounded up to the penny) that gives at least this margin. */
export function rrpForMargin(packCost: number, marginPercent: number): number {
  return Math.ceil((packCost / (1 - marginPercent / 100)) * 100 - 1e-9) / 100;
}

export function marginTone(margin: number | null): "good" | "ok" | "bad" | null {
  if (margin == null) return null;
  return margin >= MARGIN_TARGET_PERCENT ? "good" : margin >= MARGIN_FLOOR_PERCENT ? "ok" : "bad";
}
