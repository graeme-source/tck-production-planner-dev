/**
 * The daily prep-oven review — the database side (Graeme, 2026-10-27).
 * Maths: @workspace/production-schedule meat-daily-review.ts (pure, tested).
 *
 * After production it takes every put-in record not yet reviewed
 * (meat_put_in_records, made when the first tray went in) and works out:
 *   ready   first tin of that recipe's filling mixed (Mixing station tick)
 *   needed  when the builders were free for that recipe (the last batch of
 *           the recipe they built before it, or the building start)
 * then stores the verdict: on time / early / late put-in, ready in time,
 * builders' wait, minutes sitting, and whose fault (model / human / capacity).
 *
 * Runs before a review existed have no snapshot: they're backfilled from the
 * oven trays with no suggestion (followed = unknown), so the trust signal and
 * outcome history start from real data straight away instead of from zero.
 */
import { db, meatPutInRecordsTable, appSettingsTable } from "@workspace/db";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  reviewRun, runsToExclude, trustSignal, builderFreeAtMinutes, parseClock, DEFAULT_START_TIME,
  type ReviewedRun, type TrustSignal, type Outcome, type BuiltItemSpan,
} from "@workspace/production-schedule";
import { londonDateString } from "./london-time";
import { reasonThresholdMinutes } from "./meat-put-in";

/** Backfill and trust look back this far. */
export const REVIEW_HISTORY_DAYS = 45;

function daysAgo(n: number): string {
  return londonDateString(new Date(Date.now() - n * 86_400_000));
}

/** London minute-of-day of a UTC wall-clock timestamp column, in SQL. */
const londonMinutes = (col: ReturnType<typeof sql>) =>
  sql`(extract(hour FROM (${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London')) * 60
     + extract(minute FROM (${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London')))::int`;

/** Records for oven runs that went in without a snapshot (history, or a failed snapshot).
 *  Past days only: today's snapshots are made live as each first tray goes in. */
export async function backfillPutInRecords(): Promise<number> {
  const since = daysAgo(REVIEW_HISTORY_DAYS);
  const res = await db.execute(sql`
    INSERT INTO meat_put_in_records
      (plan_id, plan_date, recipe_id, recipe_name, ingredient_id, ingredient_name, put_in_at, put_in_minutes)
    SELECT o.plan_id, p.plan_date, o.recipe_id,
           COALESCE(max(o.recipe_name), 'Recipe #' || o.recipe_id),
           o.ingredient_id, COALESCE(max(i.name), max(o.ingredient_name), 'Ingredient'),
           min(o.oven_in_at) AT TIME ZONE 'UTC',
           ${londonMinutes(sql`min(o.oven_in_at)`)}
      FROM oven_events o
      JOIN production_plans p ON p.id = o.plan_id
      JOIN ingredients i ON i.id = o.ingredient_id
     WHERE o.recipe_id IS NOT NULL AND o.ingredient_id IS NOT NULL
       AND p.plan_date >= ${since} AND p.plan_date < ${londonDateString()}
     GROUP BY o.plan_id, p.plan_date, o.recipe_id, o.ingredient_id
    ON CONFLICT (plan_id, recipe_id, ingredient_id) DO NOTHING
  `);
  return res.rowCount ?? 0;
}

async function buildingStartMinutes(): Promise<number> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable)
    .where(eq(appSettingsTable.key, "building_start_time")).limit(1);
  return parseClock(row?.value ?? DEFAULT_START_TIME) ?? parseClock(DEFAULT_START_TIME)!;
}

/**
 * Review every unreviewed record on a plan day that's finished building
 * (any day before today, or today once `includeToday`).
 */
export async function reviewDueRecords(includeToday: boolean): Promise<number> {
  const today = londonDateString();
  const due = await db
    .select()
    .from(meatPutInRecordsTable)
    .where(and(
      isNull(meatPutInRecordsTable.reviewedAt),
      includeToday ? lte(meatPutInRecordsTable.planDate, today) : sql`${meatPutInRecordsTable.planDate} < ${today}`,
    ));
  if (due.length === 0) return 0;
  const startMinutes = await buildingStartMinutes();
  const threshold = await reasonThresholdMinutes();

  const planIds = [...new Set(due.map(d => d.planId))];
  // Per plan item: first + last building batch, first mixing tin (London minutes).
  const spans = await db.execute<{ plan_id: number; plan_item_id: number; recipe_id: number; first_build: number | null; last_build: number | null; first_mix: number | null }>(sql`
    SELECT pi.plan_id, pi.id AS plan_item_id, pi.recipe_id,
      ${londonMinutes(sql`min(bc.completed_at) FILTER (WHERE bc.station_type IN ('building_1','building_2'))`)} AS first_build,
      ${londonMinutes(sql`max(bc.completed_at) FILTER (WHERE bc.station_type IN ('building_1','building_2'))`)} AS last_build,
      ${londonMinutes(sql`min(bc.completed_at) FILTER (WHERE bc.station_type = 'mixing')`)} AS first_mix
    FROM production_plan_items pi
    JOIN batch_completions bc ON bc.plan_item_id = pi.id
    WHERE pi.plan_id IN (${sql.join(planIds.map(id => sql`${id}`), sql`, `)})
    GROUP BY pi.plan_id, pi.id, pi.recipe_id
  `);
  const byPlan = new Map<number, typeof spans.rows>();
  for (const r of spans.rows) {
    const list = byPlan.get(Number(r.plan_id)) ?? [];
    list.push(r);
    byPlan.set(Number(r.plan_id), list);
  }

  let n = 0;
  for (const rec of due) {
    const rows = byPlan.get(rec.planId) ?? [];
    const built: BuiltItemSpan[] = rows
      .filter(r => r.first_build != null && r.last_build != null)
      .map(r => ({ planItemId: Number(r.plan_item_id), firstTickMinutes: Number(r.first_build), lastTickMinutes: Number(r.last_build) }));
    const mine = rows.filter(r => Number(r.recipe_id) === rec.recipeId);
    const ready = mine.map(r => r.first_mix).filter((v): v is number => v != null).map(Number);
    const needed = mine
      .map(r => builderFreeAtMinutes(built, Number(r.plan_item_id), startMinutes))
      .filter((v): v is number => v != null);
    const review = reviewRun({
      suggestedAtMinutes: rec.suggestedAtMinutes,
      putInAtMinutes: rec.putInMinutes,
      readyAtMinutes: ready.length ? Math.min(...ready) : null,
      neededAtMinutes: needed.length ? Math.min(...needed) : null,
      reasonCode: rec.reasonCode,
    }, { followToleranceMinutes: threshold, tooEarlyMinutes: 30, readyGraceMinutes: 2 });
    await db.update(meatPutInRecordsTable).set({
      readyAtMinutes: ready.length ? Math.min(...ready) : null,
      neededAtMinutes: needed.length ? Math.min(...needed) : null,
      outcome: review.outcome,
      cause: review.cause,
      followed: review.followed,
      waitMinutes: review.waitMinutes,
      satMinutes: review.satMinutes,
      reviewedAt: new Date(),
    }).where(eq(meatPutInRecordsTable.id, rec.id));
    n += 1;
  }
  return n;
}

async function reviewedFor(ingredientIds: number[]) {
  if (ingredientIds.length === 0) return [];
  return db
    .select()
    .from(meatPutInRecordsTable)
    .where(and(
      inArray(meatPutInRecordsTable.ingredientId, ingredientIds),
      isNotNull(meatPutInRecordsTable.reviewedAt),
      gte(meatPutInRecordsTable.planDate, daysAgo(REVIEW_HISTORY_DAYS)),
    ))
    .orderBy(desc(meatPutInRecordsTable.planDate));
}

/** Trust signal per raw meat from its reviewed runs (one entry per run). */
export async function trustByIngredient(ingredientIds: number[]): Promise<Map<number, TrustSignal>> {
  const rows = await reviewedFor(ingredientIds);
  const out = new Map<number, TrustSignal>();
  for (const id of ingredientIds) {
    const mine = rows.filter(r => r.ingredientId === id);
    out.set(id, trustSignal(mine.map(r => ({ planDate: String(r.planDate), outcome: (r.outcome ?? "unknown") as Outcome }))));
  }
  return out;
}

/** Runs the learner should leave out, per raw meat, plus any habit found. */
export async function learningExclusions(ingredientIds: number[]): Promise<Map<number, { exclude: Set<string>; habit: "early" | "late" | null }>> {
  const rows = await reviewedFor(ingredientIds);
  const out = new Map<number, { exclude: Set<string>; habit: "early" | "late" | null }>();
  for (const id of ingredientIds) {
    const runs: ReviewedRun[] = rows.filter(r => r.ingredientId === id).map(r => ({
      key: `${r.planId}:${r.recipeId}`,
      planDate: String(r.planDate),
      followed: r.followed,
      deviationMinutes: r.deviationMinutes,
      reasonCode: r.reasonCode,
    }));
    out.set(id, runsToExclude(runs));
  }
  return out;
}

/** Per raw meat: the outcome and cause counts over the review window, for the managers' card. */
export async function reviewStatsByIngredient(ingredientIds: number[]) {
  const rows = await reviewedFor(ingredientIds);
  const out = new Map<number, {
    reviewed: number; followed: number; notFollowed: number; perfect: number; waited: number; tooEarly: number;
    model: number; human: number; capacity: number; avgWait: number | null; avgSat: number | null;
  }>();
  for (const id of ingredientIds) {
    const mine = rows.filter(r => r.ingredientId === id);
    const waits = mine.map(r => r.waitMinutes).filter((v): v is number => v != null && v > 0);
    const sats = mine.map(r => r.satMinutes).filter((v): v is number => v != null);
    out.set(id, {
      reviewed: mine.length,
      followed: mine.filter(r => r.followed === true).length,
      notFollowed: mine.filter(r => r.followed === false).length,
      perfect: mine.filter(r => r.outcome === "perfect").length,
      waited: mine.filter(r => r.outcome === "builders_waited").length,
      tooEarly: mine.filter(r => r.outcome === "too_early").length,
      model: mine.filter(r => r.cause === "model").length,
      human: mine.filter(r => r.cause === "human").length,
      capacity: mine.filter(r => r.cause === "capacity").length,
      avgWait: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      avgSat: sats.length ? Math.round(sats.reduce((a, b) => a + b, 0) / sats.length) : null,
    });
  }
  return out;
}

/** The last 7 days: every off-time put-in and its reason, for managers. */
export async function weeklyReasonSummary() {
  const rows = await db
    .select()
    .from(meatPutInRecordsTable)
    .where(and(gte(meatPutInRecordsTable.planDate, daysAgo(7)), isNotNull(meatPutInRecordsTable.deviationMinutes)))
    .orderBy(desc(meatPutInRecordsTable.planDate));
  const threshold = await reasonThresholdMinutes();
  const off = rows.filter(r => Math.abs(r.deviationMinutes ?? 0) > threshold);
  const counts = new Map<string, number>();
  for (const r of off) counts.set(r.reasonCode ?? "not_answered", (counts.get(r.reasonCode ?? "not_answered") ?? 0) + 1);
  return {
    putIns: rows.length,
    onTime: rows.length - off.length,
    offTime: off.length,
    byReason: [...counts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    items: off.map(r => ({
      id: r.id, planDate: String(r.planDate), recipeName: r.recipeName, ingredientName: r.ingredientName,
      suggestedAtMinutes: r.suggestedAtMinutes, putInMinutes: r.putInMinutes, deviationMinutes: r.deviationMinutes,
      reasonCode: r.reasonCode, reasonNote: r.reasonNote, outcome: r.outcome,
    })),
  };
}
