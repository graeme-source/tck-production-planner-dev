/**
 * The daily prep-oven review — the database side (Graeme, 2026-10-27).
 * Maths: @workspace/production-schedule meat-daily-review.ts (pure, tested).
 *
 * After production it takes every put-in record not yet reviewed
 * (meat_put_in_records, made when the first tray went in) and works out:
 *   out     first tray out cooked (probe reading preferred over the tap)
 *   ready   first tin of that recipe's filling mixed (Mixing station tick)
 *   needed  when the builders were free for that recipe (the last batch of
 *           the recipe they built before it, or the building start)
 *   safety  HACCP evidence, only when the chill was MEASURED (a registered
 *           probe, else a plausible "mark as chilled" tap): out of the oven →
 *           last batch at 8 °C, and whether that was within 240 min. Never
 *           an assumed chill time.
 * then stores: put in on time / early / late, minutes sat, builders' wait,
 * the cost (sat + 4 × wait), whose fault (model / human / capacity), and
 * whether the 4-hour rule was met.
 *
 * Runs before a review existed have no snapshot: they're backfilled from the
 * oven trays with no suggestion (followed = unknown), so the trust signal and
 * outcome history start from real data straight away instead of from zero.
 */
import { db, meatPutInRecordsTable, appSettingsTable, ingredientsTable } from "@workspace/db";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  reviewRun, runsToExclude, trustSignal, builderFreeAtMinutes, parseClock, DEFAULT_START_TIME, REVIEW_RULES, needsReason,
  resolveChillMinutes, percentile, LEARNING_RULES,
  type ReviewedRun, type TrustSignal, type Outcome, type BuiltItemSpan,
} from "@workspace/production-schedule";
import { londonDateString, londonMinuteOfDay } from "./london-time";
import { reasonThresholdMinutes } from "./meat-put-in";
import { loadMeatTimingSettings } from "./meat-timing-learner";
import { buildLiveSchedule } from "./live-schedule";

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

const idList = (ids: number[]) => sql.join(ids.map(id => sql`${id}`), sql`, `);

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
  const settings = await loadMeatTimingSettings();
  const planIds = [...new Set(due.map(d => d.planId))];

  // Per meat run: trays, and the first time it came out cooked (probe reading
  // preferred over the out tap) — the clock for the 4-hour rule.
  const trayRows = await db.execute<{ plan_id: number; recipe_id: number; ingredient_id: number; n: number; first_out: number | null }>(sql`
    SELECT o.plan_id, o.recipe_id, o.ingredient_id, count(*)::int AS n,
      ${londonMinutes(sql`min(COALESCE((
        SELECT min(t.recorded_at) FROM temperature_records t
         WHERE t.plan_id = o.plan_id AND t.recipe_id = o.recipe_id AND t.ingredient_id = o.ingredient_id
           AND t.tray_index = o.tray_index AND t.record_type = 'cooked_core' AND t.recorded_at >= o.oven_in_at
      ), o.oven_out_at))`)} AS first_out
    FROM oven_events o
    WHERE o.plan_id IN (${idList(planIds)}) AND o.recipe_id IS NOT NULL AND o.ingredient_id IS NOT NULL
    GROUP BY 1, 2, 3
  `);
  const runKey = (p: number, r: number, i: number) => `${p}:${r}:${i}`;
  const trayInfo = new Map(trayRows.rows.map(r => [runKey(Number(r.plan_id), Number(r.recipe_id), Number(r.ingredient_id)), r]));

  // Per plan item: first + last building batch, first mixing tin, last bake (ovens).
  const spans = await db.execute<{ plan_id: number; plan_item_id: number; recipe_id: number; first_build: number | null; last_build: number | null; first_mix: number | null; last_bake_ms: number | null }>(sql`
    SELECT pi.plan_id, pi.id AS plan_item_id, pi.recipe_id,
      ${londonMinutes(sql`min(bc.completed_at) FILTER (WHERE bc.station_type IN ('building_1','building_2'))`)} AS first_build,
      ${londonMinutes(sql`max(bc.completed_at) FILTER (WHERE bc.station_type IN ('building_1','building_2'))`)} AS last_build,
      ${londonMinutes(sql`min(bc.completed_at) FILTER (WHERE bc.station_type = 'mixing')`)} AS first_mix,
      extract(epoch FROM max(bc.completed_at) FILTER (WHERE bc.station_type = 'ovens')) * 1000 AS last_bake_ms
    FROM production_plan_items pi
    JOIN batch_completions bc ON bc.plan_item_id = pi.id
    WHERE pi.plan_id IN (${idList(planIds)})
    GROUP BY pi.plan_id, pi.id, pi.recipe_id
  `);
  const byPlan = new Map<number, typeof spans.rows>();
  for (const r of spans.rows) {
    const list = byPlan.get(Number(r.plan_id)) ?? [];
    list.push(r);
    byPlan.set(Number(r.plan_id), list);
  }

  // Chill evidence per recipe per plan: the "mark as chilled" tap (never the
  // auto-stamp at wrapping) and any probe registered to it.
  const taps = await db.execute<{ plan_id: number; recipe_id: number; ms: number }>(sql`
    SELECT plan_id, recipe_id, extract(epoch FROM max(chill_end_at)) * 1000 AS ms
      FROM batch_weight_records
     WHERE plan_id IN (${idList(planIds)}) AND chill_end_at IS NOT NULL AND chilled_via <> 'wrapping_complete_auto'
     GROUP BY 1, 2
  `);
  const tapOf = new Map(taps.rows.map(r => [`${r.plan_id}:${r.recipe_id}`, Number(r.ms)]));
  const probes = await db.execute<{ plan_id: number; recipe_id: number; ms: number; temp_c: string }>(sql`
    SELECT a.plan_id, a.recipe_id, extract(epoch FROM pr.recorded_at) * 1000 AS ms, pr.temp_c
      FROM probe_assignments a
      JOIN probe_readings pr ON pr.probe_id = a.probe_id
      JOIN production_plans p ON p.id = a.plan_id
     WHERE a.plan_id IN (${idList(planIds)}) AND a.purpose = 'chill'
       AND pr.recorded_at >= p.plan_date::timestamp AT TIME ZONE 'Europe/London'
       AND pr.recorded_at < (p.plan_date + 1)::timestamp AT TIME ZONE 'Europe/London'
  `);
  const probesOf = new Map<string, Array<{ atMs: number; tempC: number }>>();
  for (const r of probes.rows) {
    const k = `${r.plan_id}:${r.recipe_id}`;
    const list = probesOf.get(k) ?? [];
    list.push({ atMs: Number(r.ms), tempC: Number(r.temp_c) });
    probesOf.set(k, list);
  }

  // Buffers now, for records made before a buffer was snapshotted.
  const ingIds = [...new Set(due.map(d => d.ingredientId))];
  const bufferRows = await db.select({ id: ingredientsTable.id, buffer: ingredientsTable.meatBufferMinutes })
    .from(ingredientsTable).where(inArray(ingredientsTable.id, ingIds));
  const bufferOf = new Map(bufferRows.map(r => [r.id, r.buffer]));

  const replayCache = new Map<string, Awaited<ReturnType<typeof buildLiveSchedule>>>();
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
    const lastBuilt = mine.map(r => r.last_build).filter((v): v is number => v != null).map(Number);
    const lastBakeMs = mine.map(r => r.last_bake_ms).filter((v): v is number => v != null).map(Number);
    const info = trayInfo.get(runKey(rec.planId, rec.recipeId, rec.ingredientId));
    const outAt = info?.first_out != null ? Number(info.first_out) : null;
    const trays = rec.trayCount ?? (info ? Number(info.n) : null);

    // Predicted need for history made before snapshots: replay the live
    // schedule at the moment the meat went in. (Uses today's build-time
    // settings — close enough for the buffer's error spread.)
    let predictedNeed = rec.predictedNeedMinutes;
    if (predictedNeed == null) {
      try {
        const ck = `${rec.planId}:${rec.putInMinutes}`;
        if (!replayCache.has(ck)) replayCache.set(ck, await buildLiveSchedule(rec.planId, new Date(rec.putInAt)));
        const r = replayCache.get(ck)?.recipes.find(x => x.recipeId === rec.recipeId);
        if (r && r.state !== "done") predictedNeed = Math.round(r.liveStartMinutes);
      } catch (err) {
        console.warn("[meat-review] replay failed for record", rec.id, err);
      }
    }

    // Chill, measured only: probe → plausible tap (meat-safety.ts).
    const lastBake = lastBakeMs.length ? Math.max(...lastBakeMs) : null;
    const chill = resolveChillMinutes({
      lastBakeAtMs: lastBake,
      probeReadings: probesOf.get(`${rec.planId}:${rec.recipeId}`) ?? null,
      chilledTapAtMs: tapOf.get(`${rec.planId}:${rec.recipeId}`) ?? null,
    });
    const chilledAt = chill && lastBake != null ? londonMinuteOfDay(new Date(lastBake)) + chill.minutes : null;
    const buffer = rec.bufferMinutes ?? bufferOf.get(rec.ingredientId) ?? LEARNING_RULES.bufferStart;

    const review = reviewRun({
      suggestedAtMinutes: rec.suggestedAtMinutes,
      putInAtMinutes: rec.putInMinutes,
      readyAtMinutes: ready.length ? Math.min(...ready) : null,
      neededAtMinutes: needed.length ? Math.min(...needed) : null,
      reasonCode: rec.reasonCode,
      trayCount: trays,
      bufferMinutes: buffer,
      outAtMinutes: outAt,
      chilledAtMinutes: chilledAt,
    }, { ...REVIEW_RULES, followToleranceMinutes: threshold, waitWeight: settings.waitWeight });

    await db.update(meatPutInRecordsTable).set({
      predictedNeedMinutes: predictedNeed,
      outAtMinutes: outAt,
      readyAtMinutes: ready.length ? Math.min(...ready) : null,
      neededAtMinutes: needed.length ? Math.min(...needed) : null,
      bufferMinutes: buffer,
      outcome: review.outcome,
      cause: review.cause,
      followed: review.followed,
      trayCount: trays,
      waitMinutes: review.waitMinutes,
      satMinutes: review.satMinutes,
      costMinutes: review.costMinutes,
      lastBuiltMinutes: lastBuilt.length ? Math.max(...lastBuilt) : null,
      safetyMinutes: review.safetyMinutes,
      safetyBreach: review.safetyMinutes == null ? null : review.safetyBreach,
      chillSource: review.safetyMinutes == null ? null : chill?.source ?? null,
      chillMinutes: review.safetyMinutes == null ? null : chill?.minutes ?? null,
      reviewedAt: new Date(),
    }).where(eq(meatPutInRecordsTable.id, rec.id));
    n += 1;
  }
  return n;
}

/**
 * Cover for COLD mixes ("any time before HH:MM"): how much earlier than
 * predicted the builders have reached a recipe — 80th percentile over the
 * review window, 2–25 min; 5 until there are 5 days of evidence.
 */
export async function coldMixBufferMinutes(): Promise<number> {
  const rows = await db
    .select({ p: meatPutInRecordsTable.predictedNeedMinutes, a: meatPutInRecordsTable.neededAtMinutes })
    .from(meatPutInRecordsTable)
    .where(and(
      isNotNull(meatPutInRecordsTable.predictedNeedMinutes),
      isNotNull(meatPutInRecordsTable.neededAtMinutes),
      gte(meatPutInRecordsTable.planDate, daysAgo(REVIEW_HISTORY_DAYS)),
    ));
  const early = rows.map(r => Math.max(0, (r.p ?? 0) - (r.a ?? 0)));
  if (early.length < 5) return LEARNING_RULES.bufferStart;
  return Math.round(Math.min(LEARNING_RULES.bufferMax, Math.max(LEARNING_RULES.bufferMin, percentile(early, 0.8))));
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
    totalSat: number; totalWait: number; safetyChecked: number; safetyBreaches: number; worstSafetyMinutes: number | null;
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
      totalSat: mine.reduce((t, r) => t + (r.satMinutes ?? 0), 0),
      totalWait: mine.reduce((t, r) => t + (r.waitMinutes ?? 0), 0),
      safetyChecked: mine.filter(r => r.safetyMinutes != null).length,
      safetyBreaches: mine.filter(r => r.safetyBreach === true).length,
      worstSafetyMinutes: mine.reduce<number | null>((m, r) => r.safetyMinutes == null ? m : Math.max(m ?? 0, r.safetyMinutes), null),
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
  const rules = { ...REVIEW_RULES, followToleranceMinutes: threshold };
  const off = rows.filter(r => needsReason(r.deviationMinutes, rules, r.trayCount ?? 0));
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

/**
 * The two plain numbers the managers' card leads with (Graeme, 2026-10-27):
 * how long meat sat ready waiting, and how many times the builders waited,
 * over the last `days` days. Plus the measured 4-hour evidence count.
 */
export async function headlineNumbers(days = 14) {
  const rows = await db
    .select({
      sat: meatPutInRecordsTable.satMinutes,
      wait: meatPutInRecordsTable.waitMinutes,
      outcome: meatPutInRecordsTable.outcome,
      safety: meatPutInRecordsTable.safetyMinutes,
      breach: meatPutInRecordsTable.safetyBreach,
    })
    .from(meatPutInRecordsTable)
    .where(and(isNotNull(meatPutInRecordsTable.reviewedAt), gte(meatPutInRecordsTable.planDate, daysAgo(days))));
  const sats = rows.map(r => r.sat).filter((v): v is number => v != null);
  return {
    days,
    runs: rows.length,
    avgSatMinutes: sats.length ? Math.round(sats.reduce((a, b) => a + b, 0) / sats.length) : null,
    builderWaits: rows.filter(r => r.outcome === "builders_waited").length,
    measuredChillDays: rows.filter(r => r.safety != null).length,
    measuredOverLimit: rows.filter(r => r.breach === true).length,
  };
}
