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
  productionPlansTable,
  recipesTable,
  stationBreaksTable,
  appSettingsTable,
} from "@workspace/db";
import { and, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { londonEndOfDay } from "./london-time";
import { getOrdersByTag } from "../services/shopify";

const MAC_CHEESE_CATEGORY = "Macaroni Cheese";

/**
 * Builder batches/hour for a single day, matching the calculation
 * the Analytics page uses on /api/reports/production-kpis.
 *
 * Active minutes = wallclock from earliest to latest building
 * completion minus configured break + lunch minutes (per break
 * type taken, regardless of logged duration — keeps the KPI
 * predictable).
 *
 * Total batches = sum of building completions per plan item, each
 * capped at the plan item's batchesTarget. Mac & cheese packs are
 * deliberately excluded so calzone batches and mac packs can't
 * distort each other's BPH.
 */
export async function computeBuilderBatchesPerHourForDay(dateIso: string): Promise<{
  totalBatches: number;
  activeMinutes: number;
  batchesPerHour: number | null;
}> {
  const dayStart = new Date(`${dateIso}T00:00:00`);
  const dayEnd = londonEndOfDay(new Date(`${dateIso}T00:00:00`));

  const completions = await db
    .select({
      planItemId: batchCompletionsTable.planItemId,
      stationType: batchCompletionsTable.stationType,
      completedAt: batchCompletionsTable.completedAt,
      planId: productionPlanItemsTable.planId,
      recipeCategory: recipesTable.category,
      batchesTarget: productionPlanItemsTable.batchesTarget,
    })
    .from(batchCompletionsTable)
    .innerJoin(productionPlanItemsTable, eq(batchCompletionsTable.planItemId, productionPlanItemsTable.id))
    .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
    .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(and(
      gte(batchCompletionsTable.completedAt, dayStart),
      lte(batchCompletionsTable.completedAt, dayEnd),
      sql`${batchCompletionsTable.stationType} IN ('building_1','building_2')`,
    ));

  if (completions.length === 0) {
    return { totalBatches: 0, activeMinutes: 0, batchesPerHour: null };
  }

  // Sum calzone completions per plan item, capped at the target so
  // "extra" batches don't inflate the rate.
  const calzonePerItem = new Map<number, number>();
  const calzoneTargets = new Map<number, number>();
  for (const c of completions) {
    if (c.recipeCategory === MAC_CHEESE_CATEGORY) continue; // mac packs excluded
    calzonePerItem.set(c.planItemId, (calzonePerItem.get(c.planItemId) ?? 0) + 1);
    if (!calzoneTargets.has(c.planItemId)) calzoneTargets.set(c.planItemId, c.batchesTarget ?? 0);
  }
  let totalBatches = 0;
  for (const [itemId, built] of calzonePerItem) {
    totalBatches += Math.min(built, calzoneTargets.get(itemId) ?? 0);
  }
  if (totalBatches === 0) {
    return { totalBatches: 0, activeMinutes: 0, batchesPerHour: null };
  }

  // Wallclock spans earliest → latest building completion (any
  // recipe — including mac, which still consumed staff time).
  const times = completions.map(c => c.completedAt.getTime());
  const earliest = Math.min(...times);
  const latest = Math.max(...times);
  const wallClockMinutes = Math.round((latest - earliest) / 60_000);

  // Subtract configured break/lunch minutes if those breaks were
  // taken — matches the analytics behaviour exactly.
  const [breakSetting, lunchSetting] = await Promise.all([
    db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, "default_break_minutes")).limit(1),
    db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, "default_lunch_minutes")).limit(1),
  ]);
  const configuredBreakMins = breakSetting[0]?.value ? Number(breakSetting[0].value) : 15;
  const configuredLunchMins = lunchSetting[0]?.value ? Number(lunchSetting[0].value) : 45;

  const breaks = await db
    .select({ stationType: stationBreaksTable.stationType, breakType: stationBreaksTable.breakType, endedAt: stationBreaksTable.endedAt })
    .from(stationBreaksTable)
    .where(and(
      gte(stationBreaksTable.startedAt, dayStart),
      lte(stationBreaksTable.startedAt, dayEnd),
      sql`${stationBreaksTable.endedAt} IS NOT NULL`,
      sql`${stationBreaksTable.stationType} IN ('building_1','building_2')`,
    ));
  const hasLunch = breaks.some(b => b.breakType === "lunch");
  const hasSnackBreak = breaks.some(b => b.breakType !== "lunch");
  const totalBreakMins = (hasLunch ? configuredLunchMins : 0) + (hasSnackBreak ? configuredBreakMins : 0);

  const activeMinutes = Math.max(0, wallClockMinutes - totalBreakMins);
  if (activeMinutes < 1) {
    return { totalBatches, activeMinutes, batchesPerHour: null };
  }

  const batchesPerHour = Math.round((totalBatches / (activeMinutes / 60)) * 10) / 10;
  return { totalBatches, activeMinutes, batchesPerHour };
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
