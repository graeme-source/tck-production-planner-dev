/**
 * "Mix +g" — the extra a recipe line asks for at the mixing station, and how
 * much of it prep has to make (Graeme, 2026-10-15).
 *
 * Each recipe ingredient / sub-recipe line can carry a mixing overage
 * (recipe_ingredients.mixing_overage / recipe_sub_recipes.mixing_overage),
 * stored in the LINE's unit (a kg line stores kg; the editor takes grams).
 * It is a fixed extra PER PRODUCTION DAY for each recipe on the plan — added
 * once per plan item, never per batch — and like every recipe quantity it is
 * a cooked/processed amount. GET /production-plans/:id/filling-mix has always
 * added it to the mixing tins; this module makes prep make it too, so the
 * mixing station never asks for meat, peppers or feta nobody prepped.
 * Things nobody preps (fior di latte from the fridge) are simply pulled out
 * at mixing, as before.
 *
 * The rules, mirroring how the mixing station reads the same rows:
 *   - only lines in the filling mix carry an extra (the editor only offers the
 *     field there, and the mixing screen only reads filling-mix lines);
 *   - a marinade line (marinade_for_ingredient_id set) is merged into its meat
 *     at mixing, so its OWN Mix +g is never used — the meat line's Mix +g
 *     covers meat and marinade together;
 *   - that meat-line extra is therefore split between the meat and each of its
 *     filling-mix marinade lines in proportion to their per-portion
 *     quantities (compared as grams via @workspace/units). Prep then makes
 *     enough meat AND marinade for the merged figure mixing asks for. When a
 *     quantity can't be weighed (a count unit) the whole extra stays on the
 *     meat rather than guessing.
 * Raw prep weight is cooked ÷ processing ratio, exactly as for the rest of the
 * line (mixExtraPrepQty).
 *
 * Pure: no database. lib/mix-extra-loader.ts reads the rows.
 */
import { gramsOrNull, convertQuantity, cookedToRaw } from "@workspace/units";

export type MixLineKind = "ingredient" | "subRecipe";

export interface MixLine {
  kind: MixLineKind;
  /** recipe_ingredients.id / recipe_sub_recipes.id */
  lineId: number;
  /** Ingredient id (ingredient lines) or sub-recipe id (sub-recipe lines). */
  itemId: number;
  /** Cooked quantity per portion, in the line's unit. */
  quantityPerPortion: number;
  /** Ingredient unit, or the sub-recipe's yield unit. */
  unit: string | null;
  /** Mix +g as stored — the line's unit, per production day. */
  mixingOverage: number;
  includeInFillingMix: boolean;
  marinadeForIngredientId: number | null;
}

/** Extra per plan item (one production day), keyed by mixLineKey, in each
 *  line's own unit, cooked basis. Lines with no extra are absent. */
export type MixExtras = ReadonlyMap<string, number>;

export function mixLineKey(kind: MixLineKind, lineId: number): string {
  return `${kind}:${lineId}`;
}

export function computeMixExtras(lines: readonly MixLine[]): Map<string, number> {
  const out = new Map<string, number>();
  const add = (line: MixLine, qty: number) => {
    if (!(qty > 0)) return;
    const k = mixLineKey(line.kind, line.lineId);
    out.set(k, (out.get(k) ?? 0) + qty);
  };

  for (const line of lines) {
    const overage = Number(line.mixingOverage) || 0;
    if (!(overage > 0)) continue;
    if (!line.includeInFillingMix) continue;
    if (line.marinadeForIngredientId != null) continue;

    // Only an ingredient (a meat) can have marinades linked to it.
    const marinades = line.kind === "ingredient"
      ? lines.filter(m => m.includeInFillingMix && m.marinadeForIngredientId === line.itemId)
      : [];
    if (marinades.length === 0) { add(line, overage); continue; }

    const meatG = gramsOrNull(Number(line.quantityPerPortion) || 0, line.unit);
    const overageG = gramsOrNull(overage, line.unit);
    const marinadeG = marinades.map(m => gramsOrNull(Number(m.quantityPerPortion) || 0, m.unit));
    if (meatG == null || overageG == null || marinadeG.some(g => g == null)) { add(line, overage); continue; }
    const totalG = meatG + marinadeG.reduce<number>((s, g) => s + (g ?? 0), 0);
    if (!(totalG > 0)) { add(line, overage); continue; }

    add(line, overage * (meatG / totalG));
    marinades.forEach((m, i) => {
      const shareG = overageG * ((marinadeG[i] ?? 0) / totalG);
      add(m, convertQuantity(shareG, "g", m.unit) ?? 0);
    });
  }
  return out;
}

/** The extra for one line (0 when none). */
export function mixExtraFor(extras: MixExtras | null | undefined, kind: MixLineKind, lineId: number | null | undefined): number {
  if (!extras || lineId == null) return 0;
  return extras.get(mixLineKey(kind, lineId)) ?? 0;
}

/** Spread a per-day extra over a plan item's batches, so code that works per
 *  batch (quantityPerBatch × batchesTarget) totals to exactly one extra.
 *  0 when the recipe isn't being made (no batches → no extra). */
export function mixExtraPerBatch(extra: number, batchesTarget: number): number {
  const bt = Number(batchesTarget) || 0;
  if (!(bt > 0) || !(extra > 0)) return 0;
  return extra / bt;
}

/** A sub-recipe line's extra expands into the sub-recipe's ingredients in
 *  proportion: each component carries extra ÷ total of its scaled quantity
 *  (components were resolved at the line's quantity + extra). */
export function subRecipeComponentExtras(
  componentQtys: readonly number[],
  lineQtyIncludingExtra: number,
  extra: number,
): number[] {
  if (!(extra > 0) || !(lineQtyIncludingExtra > 0)) return componentQtys.map(() => 0);
  const share = extra / lineQtyIncludingExtra;
  return componentQtys.map(q => (Number(q) || 0) * share);
}

/** A cooked extra in the weight prep works to: raw (÷ processing ratio) unless
 *  the ingredient is prepped by processed weight. */
export function mixExtraPrepQty(
  cookedExtra: number,
  processingRatio: number | null | undefined,
  prepWeightMode: string | null | undefined,
): number {
  if (!(cookedExtra > 0)) return 0;
  return prepWeightMode === "processed" ? cookedExtra : cookedToRaw(cookedExtra, processingRatio);
}

/** Tidy a float for the JSON response (the screens format it to whole grams). */
export function roundMixExtra(qty: number): number {
  return qty > 0 ? Math.round(qty * 10000) / 10000 : 0;
}

/**
 * Collects, per prep item, how much of its shown total is Mix +g — so a
 * screen can say "includes +75 g mix extra". Keyed by kind + id (ingredient
 * id or sub-recipe id), in that item's prep unit.
 */
export class MixExtraNotes {
  private readonly totals = new Map<string, number>();
  add(kind: MixLineKind, id: number, qty: number): void {
    if (!(qty > 0)) return;
    const k = `${kind}:${id}`;
    this.totals.set(k, (this.totals.get(k) ?? 0) + qty);
  }
  get(kind: MixLineKind, id: number): number {
    return roundMixExtra(this.totals.get(`${kind}:${id}`) ?? 0);
  }
}
