import { db, dptIngredientRequirementsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type SurplusMode = "percent" | "absolute";

export interface SurplusTarget {
  ingredientId: number;
  dptDailyRawQty: number;
  surplusMode: SurplusMode;
  surplusPercent: number;
  surplusAbsoluteQty: number | null;
  surplusQty: number;
  unit: string;
}

/**
 * Compute the surplus buffer quantity (in the ingredient's native unit).
 * - "percent" mode: a % of the ingredient's DPT daily raw usage.
 * - "absolute" mode: a fixed quantity stored on the ingredient, independent of
 *   daily usage. Useful for items where a flat safety stock makes more sense
 *   than a usage-scaled buffer.
 */
export function computeSurplusQty(
  dptDailyRawQty: number,
  surplusPercent: number,
  mode: SurplusMode = "percent",
  surplusAbsoluteQty: number | null = null,
): number {
  if (mode === "absolute") return Math.max(0, surplusAbsoluteQty ?? 0);
  return (dptDailyRawQty * surplusPercent) / 100;
}

export async function getSurplusTarget(
  ingredientId: number,
  surplusPercent: number,
  mode: SurplusMode = "percent",
  surplusAbsoluteQty: number | null = null,
): Promise<SurplusTarget | null> {
  const [req] = await db
    .select()
    .from(dptIngredientRequirementsTable)
    .where(eq(dptIngredientRequirementsTable.ingredientId, ingredientId))
    .limit(1);

  if (!req) return null;

  const dptDailyRawQty = Number(req.dailyQtyRaw);
  return {
    ingredientId,
    dptDailyRawQty,
    surplusMode: mode,
    surplusPercent,
    surplusAbsoluteQty,
    surplusQty: computeSurplusQty(dptDailyRawQty, surplusPercent, mode, surplusAbsoluteQty),
    unit: req.unit,
  };
}
