import { convertQuantity } from "./index";

/**
 * How many mixes of a sub-recipe make exactly what today's prep needs
 * (Graeme, 2026-11-03): 8.32 kg of chicken pie mix from a 6.2 kg mix is
 * 1.342× — so the "Exactly today's need" button on the Replenish popup
 * scales the recipe to the requirement instead of someone typing 1.34.
 *
 * Kept unrounded so the scaled total lands on the requirement to the gram;
 * round only for display. Null when it can't be worked out honestly (no
 * requirement, no yield, or units that don't convert — "3 each" vs kg).
 */
export function exactBatchMultiplier(
  requiredQty: number | null | undefined,
  requiredUnit: string | null | undefined,
  yieldPerBatch: number | null | undefined,
  yieldUnit: string | null | undefined,
): number | null {
  if (requiredQty == null || !Number.isFinite(requiredQty) || requiredQty <= 0) return null;
  if (yieldPerBatch == null || !Number.isFinite(yieldPerBatch) || yieldPerBatch <= 0) return null;
  const inYieldUnit = convertQuantity(requiredQty, requiredUnit, yieldUnit);
  if (inYieldUnit == null || inYieldUnit <= 0) return null;
  return inYieldUnit / yieldPerBatch;
}

/** "1.34×" — two decimals, trailing zeros dropped ("2×", "1.5×"). */
export function formatBatchMultiplier(m: number): string {
  return `${Number(m.toFixed(2))}×`;
}
