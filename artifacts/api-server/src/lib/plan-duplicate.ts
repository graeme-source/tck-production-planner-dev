/** DB side of the double-submit guard — the rule is in plan-duplicate-rules.ts. */
import { db, productionPlansTable, productionPlanItemsTable, type ProductionPlan } from "@workspace/db";
import { and, eq, gte, inArray } from "drizzle-orm";
import { DUPLICATE_WINDOW_MS, isDuplicateCreate, type PlanItemKey } from "./plan-duplicate-rules";

/** A plan for `planDate` made in the last couple of minutes with exactly
 *  these items — the first copy of a double-submitted create — or null. */
export async function findRecentDuplicatePlan(planDate: string, items: readonly PlanItemKey[], now: Date = new Date()): Promise<ProductionPlan | null> {
  const recent = await db.select().from(productionPlansTable).where(and(
    eq(productionPlansTable.planDate, planDate),
    gte(productionPlansTable.createdAt, new Date(now.getTime() - DUPLICATE_WINDOW_MS)),
  ));
  if (recent.length === 0) return null;
  const rows = await db.select({ planId: productionPlanItemsTable.planId, recipeId: productionPlanItemsTable.recipeId, batchesTarget: productionPlanItemsTable.batchesTarget })
    .from(productionPlanItemsTable).where(inArray(productionPlanItemsTable.planId, recent.map(p => p.id)));
  for (const p of recent) {
    const its = rows.filter(r => r.planId === p.id);
    if (isDuplicateCreate({ createdAt: p.createdAt, items: its }, items, now)) return p;
  }
  return null;
}
