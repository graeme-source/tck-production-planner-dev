/**
 * The put-in snapshot for the daily review (Graeme, 2026-10-27): "record the
 * actual put-in time against the suggested time for every item, every day."
 *
 * When the FIRST tray of a raw meat for a recipe goes into the prep oven
 * (POST /oven-events/oven-in), this stores the "in the oven by" time the
 * station was showing at that moment, from the same live schedule
 * (lib/live-schedule.ts), so tomorrow's review judges exactly what the prep
 * person was told. If it went in further off than the threshold, the station
 * asks why there and then (needsReason); unanswered ones are asked again next
 * time the station opens (GET /meat-timing/pending-reasons).
 *
 * Never blocks the tray: a failure here is logged and the tray still goes in.
 */
import { db, meatPutInRecordsTable, ingredientsTable, appSettingsTable } from "@workspace/db";
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { needsReason, REVIEW_RULES } from "@workspace/production-schedule";
import { buildLiveSchedule } from "./live-schedule";
import { londonMinuteOfDay } from "./london-time";

export const REASON_THRESHOLD_SETTING = "meat_put_in_reason_minutes";

export async function reasonThresholdMinutes(): Promise<number> {
  const [row] = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, REASON_THRESHOLD_SETTING))
    .limit(1);
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 ? n : REVIEW_RULES.followToleranceMinutes;
}

export interface PutInResult {
  recordId: number;
  suggestedAtMinutes: number | null;
  putInMinutes: number;
  deviationMinutes: number | null;
  needsReason: boolean;
  ingredientName: string;
  recipeName: string;
}

export async function recordPutIn(
  planId: number,
  recipeId: number,
  ingredientId: number,
  at: Date = new Date(),
  trayCount: number | null = null,
): Promise<PutInResult | null> {
  const [existing] = await db
    .select()
    .from(meatPutInRecordsTable)
    .where(and(
      eq(meatPutInRecordsTable.planId, planId),
      eq(meatPutInRecordsTable.recipeId, recipeId),
      eq(meatPutInRecordsTable.ingredientId, ingredientId),
    ))
    .limit(1);
  if (existing) return null; // only the first tray is the put-in

  const live = await buildLiveSchedule(planId, at);
  if (!live) return null;
  const recipe = live.recipes.find(r => r.recipeId === recipeId);
  const meat = recipe?.meats.find(m => m.rawMeatIngredientId === ingredientId);
  const [ing] = await db.select({ name: ingredientsTable.name }).from(ingredientsTable).where(eq(ingredientsTable.id, ingredientId)).limit(1);
  if (!ing) return null;

  const putInMinutes = londonMinuteOfDay(at);
  // A suggestion only counts on the day itself (a tray logged for another
  // day's plan has nothing live to compare with).
  const suggested = live.isToday && meat ? Math.round(meat.liveCookStartMinutes) : null;
  const deviation = suggested == null ? null : putInMinutes - suggested;
  const threshold = await reasonThresholdMinutes();

  const [row] = await db
    .insert(meatPutInRecordsTable)
    .values({
      planId,
      planDate: live.planDate,
      recipeId,
      recipeName: recipe?.name ?? `Recipe #${recipeId}`,
      ingredientId,
      ingredientName: ing.name,
      suggestedAtMinutes: suggested,
      plannedAtMinutes: meat ? Math.round(meat.plannedCookStartMinutes) : null,
      // When the builders were then expected to need it — the buffer learns
      // from how wrong this turns out to be.
      predictedNeedMinutes: live.isToday && recipe ? Math.round(recipe.liveStartMinutes) : null,
      leadMinutes: meat ? Math.round(meat.leadMinutes) : null,
      trayCount,
      putInAt: at,
      putInMinutes,
      deviationMinutes: deviation,
    })
    .onConflictDoNothing()
    .returning({ id: meatPutInRecordsTable.id });
  if (!row) return null;

  return {
    recordId: row.id,
    suggestedAtMinutes: suggested,
    putInMinutes,
    deviationMinutes: deviation,
    // Loading the trays takes time — the tolerance widens with them.
    needsReason: needsReason(deviation, { ...REVIEW_RULES, followToleranceMinutes: threshold }, trayCount ?? 0),
    ingredientName: ing.name,
    recipeName: recipe?.name ?? `Recipe #${recipeId}`,
  };
}

/** Put-ins on this plan still waiting for a "why?". */
export async function pendingReasons(planId: number) {
  const threshold = await reasonThresholdMinutes();
  const rows = await db
    .select()
    .from(meatPutInRecordsTable)
    .where(and(
      eq(meatPutInRecordsTable.planId, planId),
      isNull(meatPutInRecordsTable.reasonCode),
      isNotNull(meatPutInRecordsTable.deviationMinutes),
      sql`abs(${meatPutInRecordsTable.deviationMinutes}) > ${threshold}`,
    ));
  const rules = { ...REVIEW_RULES, followToleranceMinutes: threshold };
  return rows.filter(r => needsReason(r.deviationMinutes, rules, r.trayCount ?? 0)).map(r => ({
    recordId: r.id,
    recipeName: r.recipeName,
    ingredientName: r.ingredientName,
    suggestedAtMinutes: r.suggestedAtMinutes,
    putInMinutes: r.putInMinutes,
    deviationMinutes: r.deviationMinutes,
  }));
}

export async function saveReason(recordId: number, code: string, note: string | null, byName: string): Promise<boolean> {
  const updated = await db
    .update(meatPutInRecordsTable)
    .set({ reasonCode: code, reasonNote: note, reasonByName: byName, reasonAt: new Date() })
    .where(eq(meatPutInRecordsTable.id, recordId))
    .returning({ id: meatPutInRecordsTable.id });
  return updated.length > 0;
}
