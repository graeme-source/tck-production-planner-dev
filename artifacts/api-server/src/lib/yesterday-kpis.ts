/**
 * Shared yesterday-KPI helpers used by the morning-meeting dashboard
 * and (eventually) the Analytics page. Extracted so the morning
 * meeting reports the same numbers operators see in Analytics —
 * before this, the meeting was doing simpler raw-wallclock maths
 * (no break subtraction) and reading local batch_completions for
 * packing (which is empty because packing speed is computed from
 * Shopify fulfillment timestamps, not local completions).
 *
 * The two functions below mirror the calculations already trusted
 * inside /api/reports/production-kpis (builder BPH) and
 * /api/reports/packing-speed (orders/hr). Pure-function shape — no
 * Express req/res, no caching — so they're cheap to call from
 * anywhere.
 */
import {
  db,
  batchCompletionsTable,
  productionPlanItemsTable,
  recipesTable,
} from "@workspace/db";
import { and, eq, gte, lte, sql, ne } from "drizzle-orm";
import { londonStartOfDay, londonEndOfDay } from "./london-time";
import { getStandardBreakConfig, computeBatchesPerHour } from "./batches-per-hour";
import { getOrdersByTag } from "../services/shopify";

const MAC_CHEESE_CATEGORY = "Macaroni Cheese";

/**
 * Builder batches/hour for a single day — the standard method from
 * lib/batches-per-hour: calzone building completions only (mac cheese
 * ignored entirely), first→last completion window, standard break
 * lengths deducted when the window spans them.
 */
export async function computeBuilderBatchesPerHourForDay(dateIso: string): Promise<{
  totalBatches: number;
  activeMinutes: number;
  batchesPerHour: number | null;
}> {
  // Noon UTC is unambiguously the right London date in both GMT and BST.
  const anchor = new Date(`${dateIso}T12:00:00Z`);
  const dayStart = londonStartOfDay(anchor);
  const dayEnd = londonEndOfDay(anchor);

  const completions = await db
    .select({ completedAt: batchCompletionsTable.completedAt })
    .from(batchCompletionsTable)
    .innerJoin(productionPlanItemsTable, eq(batchCompletionsTable.planItemId, productionPlanItemsTable.id))
    .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(and(
      gte(batchCompletionsTable.completedAt, dayStart),
      lte(batchCompletionsTable.completedAt, dayEnd),
      sql`${batchCompletionsTable.stationType} IN ('building_1','building_2')`,
      ne(recipesTable.category, MAC_CHEESE_CATEGORY),
    ));

  const breakConfig = await getStandardBreakConfig();
  const result = computeBatchesPerHour(completions.map(c => c.completedAt), breakConfig);
  return {
    totalBatches: result.batches,
    activeMinutes: result.activeMinutes,
    batchesPerHour: result.batchesPerHour,
  };
}

/**
 * Packing orders/hour for a single dispatch day, matching the
 * calculation on /api/reports/packing-speed.
 *
 * Reads Shopify fulfillment timestamps (not local batch_completions
 * — the kitchen doesn't log packing completions locally, they're
 * captured by Shopify when the order is marked fulfilled). The
 * active window is wallclock minus any idle gaps over 10 minutes.
 *
 * dispatchDateIso is the day the order shipped FROM the kitchen.
 * Orders ship on day N for delivery on N+1, so we look up the tag
 * for the delivery day.
 */
const IDLE_THRESHOLD_MS = 10 * 60 * 1000;

export async function computePackingOrdersPerHourForDay(dispatchDateIso: string): Promise<{
  totalOrders: number;
  activeMinutes: number;
  ordersPerHour: number | null;
}> {
  const dispatchDay = new Date(`${dispatchDateIso}T00:00:00`);
  const deliveryDay = new Date(dispatchDay);
  deliveryDay.setDate(dispatchDay.getDate() + 1);
  const yyyy = deliveryDay.getUTCFullYear();
  const mm = String(deliveryDay.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(deliveryDay.getUTCDate()).padStart(2, "0");
  const tag = `${yyyy}-${mm}-${dd}`;

  const orders = await getOrdersByTag(tag);
  const fulfilled = orders.filter(o => o.fulfillment_status === "fulfilled");
  if (fulfilled.length === 0) {
    return { totalOrders: 0, activeMinutes: 0, ordersPerHour: null };
  }

  const timestamps: number[] = [];
  for (const order of fulfilled) {
    const fuls = order.fulfillments ?? [];
    const successFuls = fuls.filter(f => f.status === "success" || f.status === "fulfilled");
    if (successFuls.length > 0) {
      for (const f of successFuls) timestamps.push(new Date(f.created_at).getTime());
    } else {
      timestamps.push(new Date(order.created_at).getTime());
    }
  }

  const sorted = [...timestamps].sort((a, b) => a - b);
  const firstTs = sorted[0];
  const lastTs = sorted[sorted.length - 1];
  const windowMs = lastTs - firstTs;

  let idleMs = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > IDLE_THRESHOLD_MS) idleMs += gap;
  }

  const activeMs = Math.max(0, windowMs - idleMs);
  if (activeMs <= 60_000) {
    return { totalOrders: fulfilled.length, activeMinutes: 0, ordersPerHour: null };
  }
  const activeMinutes = Math.round(activeMs / 60_000);
  const ordersPerHour = Math.round((fulfilled.length / (activeMs / 3_600_000)) * 10) / 10;
  return { totalOrders: fulfilled.length, activeMinutes, ordersPerHour };
}
