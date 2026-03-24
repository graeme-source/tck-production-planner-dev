import { db, dptIngredientRequirementsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface SurplusTarget {
  ingredientId: number;
  dptDailyRawQty: number;
  surplusPercent: number;
  surplusQty: number;
  unit: string;
}

export function computeSurplusQty(dptDailyRawQty: number, surplusPercent: number): number {
  return (dptDailyRawQty * surplusPercent) / 100;
}

export async function getSurplusTarget(ingredientId: number, surplusPercent: number): Promise<SurplusTarget | null> {
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
    surplusPercent,
    surplusQty: computeSurplusQty(dptDailyRawQty, surplusPercent),
    unit: req.unit,
  };
}
