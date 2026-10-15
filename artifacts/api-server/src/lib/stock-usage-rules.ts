/**
 * Where each recipe line's ingredients are USED, and how much one prep tin
 * or one batch takes — the rules shared by the ordering page's "still to
 * prep" (lib/outstanding-prep.ts) and the running-stock ledger
 * (lib/stock-ledger*.ts). One copy, so the two can never disagree about
 * which tins exist or how much is in each (charter rules 2–3).
 *
 * Pure: no database.
 *
 * Channels (Graeme approved the running stock model 15 Oct 2026; see
 * docs/RUNNING_STOCK.md):
 *   - "prep"   — a direct recipe line the prep room weighs into TINS and
 *                ticks off (prep_completions). Used at the tick.
 *   - "mixing" — a direct line NOT prepped into tins but added at the mixing
 *                station (filling-mix lines such as fior di latte or a bought
 *                sauce). Used per mixing batch completion.
 *   - "build"  — a direct line added at the building station (toppings,
 *                topping cheese, drizzles). Used per built batch.
 * Sub-recipe lines (bases, sauces, dough, rubs …) are not recorded when the
 * sub-recipe is MADE (sub_recipe_completions carries no reliable quantity),
 * so their ingredients are estimated from the batches that USE them: a
 * filling-mix sub-recipe at mixing, anything else at building.
 */

/** Same tin rule the prep screens use: ceil(batches ÷ max per tin), at least
 *  2 tins once there are more than 5 batches. Null when the item has no
 *  per-tin limit (the caller then treats it as one tin). */
export function calcTinCount(batchesTarget: number, maxBatchesPerTin: number | null): number | null {
  if (!maxBatchesPerTin || batchesTarget <= 0) return null;
  const raw = Math.ceil(batchesTarget / maxBatchesPerTin);
  return batchesTarget > 5 ? Math.max(2, raw) : raw;
}

/** Categories whose direct recipe lines are never weighed into prep tins —
 *  toppings and dough are consumed on the production day, base/sauce
 *  ingredients go straight into the mix or onto the build. Kept exactly as
 *  outstanding-prep has always applied them. */
const NOT_TIN_PREPPED_CATEGORIES = new Set(["base", "sauce", "dough"]);

/** The mozzarella / fior di latte rule outstanding-prep has always used: as
 *  a topping cheese it isn't prepped into tins, only when it's part of the
 *  filling mix. (A name match inherited from the original prep screens —
 *  consolidated here so there is one copy; a per-ingredient flag would be
 *  the proper fix.) */
export function isMozzarellaLike(name: string | null | undefined): boolean {
  const lc = (name ?? "").toLowerCase();
  return lc.includes("mozzarella") || lc.includes("fior di latte");
}

export type DirectLineChannel = "prep" | "mixing" | "build";

export interface DirectLineInfo {
  isTopping: boolean;
  includeInFillingMix: boolean;
  category: string | null;
  ingredientName: string | null;
}

/** Where a direct (non-marinade) recipe ingredient line is used. "prep" is
 *  exactly the set of lines outstanding-prep counts tins for. */
export function directLineChannel(line: DirectLineInfo): DirectLineChannel {
  const fillingMix = line.includeInFillingMix;
  if (line.isTopping) return "build";
  if (NOT_TIN_PREPPED_CATEGORIES.has(line.category ?? "")) return fillingMix ? "mixing" : "build";
  if (isMozzarellaLike(line.ingredientName) && !fillingMix) return "build";
  return "prep";
}

/** Station channel for a sub-recipe line (estimated — see header). */
export function subRecipeLineChannel(includeInFillingMix: boolean): "mixing" | "build" {
  return includeInFillingMix ? "mixing" : "build";
}

export interface TinCountInput {
  batchesTarget: number;
  maxBatchesPerTin: number | null;
  includeInFillingMix: boolean;
  /** production_plan_items.mixing_tin_override (filling-mix lines). */
  mixingTinOverride: number | null;
  /** prep_tin_overrides.tin_count for this plan/recipe/ingredient. */
  tinOverride: number | null;
}

/** How many tins a prep-channel line is split into on a plan. 0 = none. */
export function tinCountForLine(input: TinCountInput): number {
  const defaultTinCount = calcTinCount(input.batchesTarget, input.maxBatchesPerTin) ?? 1;
  if (input.includeInFillingMix && input.mixingTinOverride != null) return input.mixingTinOverride;
  if (!input.includeInFillingMix && input.tinOverride != null) return input.tinOverride;
  return defaultTinCount;
}

/** Raw quantity (ingredient's own unit) a line needs for a whole plan item:
 *  per-portion × portions × batches, plus the day's Mix +g, cooked → raw
 *  through the processing ratio. Identical to outstanding-prep's maths. */
export function lineRawQtyForItem(args: {
  quantityPerPortion: number;
  portionsPerBatch: number;
  batches: number;
  mixExtra: number;
  processingRatio: number | null;
}): number {
  const cooked = (Number(args.quantityPerPortion) || 0) * (Number(args.portionsPerBatch) || 10) * args.batches
    + (Number(args.mixExtra) || 0);
  const ratio = Number(args.processingRatio) || 1;
  return ratio > 0 ? cooked / ratio : cooked;
}

/**
 * Does a tin still come off the stock figure it's compared with? A tin
 * ticked at or before the stock was counted has already left the shelf
 * and is inside the count; one ticked after, or not yet ticked, isn't.
 * With no count time every tin counts. The running-stock ledger takes the
 * complementary set (ticked after the count) as usage, so
 *   outstanding(count time) = ledger usage since count + outstanding(now)
 * — the Orders page gets the same answer whichever figure it starts from.
 */
export function isTinOutstanding(doneAtMs: number | null, checkedAtMs: number | null): boolean {
  if (doneAtMs == null || checkedAtMs == null) return true;
  return doneAtMs > checkedAtMs;
}

/** Share of one batch a building-station completion represents: a partial
 *  batch records the packs actually built. */
export function builtBatchFraction(partialPacks: number | null, portionsPerBatch: number, packSize: number): number {
  if (partialPacks == null) return 1;
  const packsPerBatch = Math.max(1, Math.floor((Number(portionsPerBatch) || 10) / (Number(packSize) || 1)));
  return Math.min(1, Math.max(0, partialPacks / packsPerBatch));
}
