/**
 * Landing queued 8-pack bags onto a production plan.
 *
 * A queued_bag_orders row says "on this production date, N bags of this
 * recipe, for Shopify order X". When the plan for that date exists, the bags
 * belong on production_plan_items.eight_pack_bag_count — the same column the
 * production overview's +/- buttons drive and the same one the wholesale-bags
 * route already writes when a plan is there at processing time. Nothing new
 * happens downstream: wrapping, packing and the pack report see an ordinary
 * bag allocation.
 *
 * Two rules keep this honest (Graeme, 2026-08-27 — "we can't afford to get
 * this wrong"):
 *
 *   1. A row is only marked 'planned' once its bags have ACTUALLY been added
 *      to a plan item. If the recipe isn't on the plan, the row stays
 *      'queued' and is returned as unlanded, so it keeps appearing on the
 *      Create Plan screen and in the bag-cover check instead of being marked
 *      done and forgotten. Silence is the failure mode we're defending
 *      against.
 *   2. Landing is idempotent by status. Running it twice for the same plan
 *      adds the bags once, because the second pass finds no 'queued' rows.
 */

import { db, queuedBagOrdersTable, productionPlanItemsTable, recipesTable } from "@workspace/db";
import { and, eq, asc, sql } from "drizzle-orm";

export interface QueuedBagRow {
  id: number;
  productionDate: string;
  deliveryDate: string;
  recipeId: number;
  recipeName: string;
  bags: number;
  shopifyOrderId: string;
  shopifyOrderName: string | null;
}

/** Every still-queued bag row for a production date, newest order last. */
export async function queuedBagsForDate(productionDate: string): Promise<QueuedBagRow[]> {
  const rows = await db
    .select({
      id: queuedBagOrdersTable.id,
      productionDate: queuedBagOrdersTable.productionDate,
      deliveryDate: queuedBagOrdersTable.deliveryDate,
      recipeId: queuedBagOrdersTable.recipeId,
      bags: queuedBagOrdersTable.bags,
      shopifyOrderId: queuedBagOrdersTable.shopifyOrderId,
      shopifyOrderName: queuedBagOrdersTable.shopifyOrderName,
      recipeName: recipesTable.name,
    })
    .from(queuedBagOrdersTable)
    .innerJoin(recipesTable, eq(queuedBagOrdersTable.recipeId, recipesTable.id))
    .where(and(
      eq(queuedBagOrdersTable.productionDate, productionDate),
      eq(queuedBagOrdersTable.status, "queued"),
    ))
    .orderBy(asc(queuedBagOrdersTable.id));
  return rows.map(r => ({ ...r, shopifyOrderName: r.shopifyOrderName ?? null }));
}

/** Still-queued bag rows across a date range, for the cover check. */
export async function queuedBagsBetween(fromDate: string, toDate: string): Promise<QueuedBagRow[]> {
  const rows = await db
    .select({
      id: queuedBagOrdersTable.id,
      productionDate: queuedBagOrdersTable.productionDate,
      deliveryDate: queuedBagOrdersTable.deliveryDate,
      recipeId: queuedBagOrdersTable.recipeId,
      bags: queuedBagOrdersTable.bags,
      shopifyOrderId: queuedBagOrdersTable.shopifyOrderId,
      shopifyOrderName: queuedBagOrdersTable.shopifyOrderName,
      recipeName: recipesTable.name,
    })
    .from(queuedBagOrdersTable)
    .innerJoin(recipesTable, eq(queuedBagOrdersTable.recipeId, recipesTable.id))
    .where(and(
      eq(queuedBagOrdersTable.status, "queued"),
      sql`${queuedBagOrdersTable.productionDate} BETWEEN ${fromDate} AND ${toDate}`,
    ))
    .orderBy(asc(queuedBagOrdersTable.productionDate), asc(queuedBagOrdersTable.id));
  return rows.map(r => ({ ...r, shopifyOrderName: r.shopifyOrderName ?? null }));
}

export interface LandResult {
  landed: Array<{ recipeId: number; recipeName: string; bags: number; orderName: string | null }>;
  /** Queued rows whose recipe isn't on the plan — still queued, still owed. */
  unlanded: QueuedBagRow[];
}

/**
 * Put every queued bag for this plan's date onto the plan.
 *
 * Called when a plan is created and again whenever its items change, so a
 * recipe added to the plan later still picks up the bags waiting for it.
 */
export async function landQueuedBags(planId: number, planDate: string): Promise<LandResult> {
  const queued = await queuedBagsForDate(planDate);
  if (queued.length === 0) return { landed: [], unlanded: [] };

  const planItems = await db
    .select({ id: productionPlanItemsTable.id, recipeId: productionPlanItemsTable.recipeId })
    .from(productionPlanItemsTable)
    .where(eq(productionPlanItemsTable.planId, planId));
  const itemByRecipe = new Map<number, number>();
  for (const it of planItems) {
    if (it.recipeId != null && !itemByRecipe.has(it.recipeId)) itemByRecipe.set(it.recipeId, it.id);
  }

  const landed: LandResult["landed"] = [];
  const unlanded: QueuedBagRow[] = [];
  for (const row of queued) {
    const itemId = itemByRecipe.get(row.recipeId);
    if (itemId == null || row.bags <= 0) {
      // The recipe isn't on this plan. Leave the row queued — it is still
      // owed to a customer and must keep being visible.
      if (row.bags > 0) unlanded.push(row);
      continue;
    }
    try {
      await db.update(productionPlanItemsTable)
        .set({ eightPackBagCount: sql`${productionPlanItemsTable.eightPackBagCount} + ${row.bags}` })
        .where(eq(productionPlanItemsTable.id, itemId));
      await db.update(queuedBagOrdersTable)
        .set({ status: "planned", planId, landedAt: new Date() })
        .where(eq(queuedBagOrdersTable.id, row.id));
      landed.push({ recipeId: row.recipeId, recipeName: row.recipeName, bags: row.bags, orderName: row.shopifyOrderName });
    } catch (err) {
      // A row that failed to land stays queued — better to ask again than to
      // record a bag allocation that isn't there.
      console.error(`[queued-bags] failed landing ${row.bags} bags of ${row.recipeName} on plan ${planId}:`, err);
      unlanded.push(row);
    }
  }
  if (landed.length) {
    console.log(`[queued-bags] plan ${planId} (${planDate}): landed ${landed.map(l => `${l.bags}× ${l.recipeName}`).join(", ")}`);
  }
  if (unlanded.length) {
    console.warn(`[queued-bags] plan ${planId} (${planDate}): STILL QUEUED (recipe not on plan) — ${unlanded.map(u => `${u.bags}× ${u.recipeName} for ${u.shopifyOrderName ?? u.shopifyOrderId}`).join(", ")}`);
  }
  return { landed, unlanded };
}

/**
 * Undo landing when a plan is deleted, so the bags can land on whatever
 * replaces it. Mirrors what DELETE /production-plans/:id does for queued
 * test production.
 */
export async function unlandQueuedBagsForPlan(planId: number): Promise<void> {
  await db.update(queuedBagOrdersTable)
    .set({ status: "queued", planId: null, landedAt: null })
    .where(and(eq(queuedBagOrdersTable.planId, planId), eq(queuedBagOrdersTable.status, "planned")));
}
