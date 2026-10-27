/**
 * Self-correcting prep-oven timings — the database side (Graeme, 2026-10-27).
 * The maths is @workspace/production-schedule meat-timing-learning.ts (pure,
 * tested); this loads the floor history, applies the changes it recommends,
 * logs every one in meat_timing_adjustments (migration 0290) and reverts them.
 *
 * Per meat it learns PROCESSING (out of the oven — probe reading preferred —
 * → first mixing tin complete) and the BUFFER (the smallest cover that keeps
 * builder waits rare). The schedule then targets: out of the oven at =
 * builders need it − processing − buffer; in = out − cook.
 *
 * AUTOMATIC from day one (Graeme). Safe because:
 *   - only processing and buffer move — never the cook time or a temperature;
 *   - each run moves a value at most 15 minutes (7 with little data);
 *   - the buffer is capped (Settings, default 25);
 *   - every change is logged with its evidence, shown to managers, and can be
 *     reverted; reverting switches learning off for that meat;
 *   - the whole thing has an off switch (meat_timing_learning_enabled).
 */
import { db, ingredientsTable, meatTimingAdjustmentsTable, appSettingsTable } from "@workspace/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  learnMeatTiming, configuredLead, LEARNING_RULES, DEFAULT_SAFETY_RULE,
  type MeatRun, type MeatLearning, type MeatTrayEvent, type TrustSignal, type LearningRules, type SafetyRule,
} from "@workspace/production-schedule";

type ReviewStats = Awaited<ReturnType<typeof import("./meat-daily-review-job").reviewStatsByIngredient>> extends Map<number, infer V> ? V : never;

/** Look back this far for runs; the learner itself uses the newest 20 clean ones. */
export const HISTORY_DAYS = 120;
export const LEARNING_ENABLED_SETTING = "meat_timing_learning_enabled";
export const LAST_AUTO_RUN_SETTING = "meat_timing_last_auto_run";
export const SAFE_TOTAL_SETTING = "meat_safe_total_minutes";
export const CHILL_SETTING = "calzone_chill_minutes";
/** Optional override; unset = learned from the ovens station. */
export const BAKE_SETTING = "calzone_bake_minutes";
export const WAIT_WEIGHT_SETTING = "builder_wait_weight";
export const BUFFER_MAX_SETTING = "meat_buffer_max_minutes";

export interface MeatTimingSettings {
  learningEnabled: boolean;
  lastAutoRun: string | null;
  /** Out of the prep oven → last batch chilled to 8 °C. 240. */
  safeTotalMinutes: number;
  /** Baked calzones chilling to 8 °C. 120. */
  chillMinutes: number;
  /** Set by hand, else null (learned from the ovens station). */
  bakeMinutesOverride: number | null;
  /** A minute of builder wait costs this many minutes of sitting. 4. */
  waitWeight: number;
  bufferMaxMinutes: number;
}

export async function loadMeatTimingSettings(): Promise<MeatTimingSettings> {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, [
      LEARNING_ENABLED_SETTING, LAST_AUTO_RUN_SETTING, SAFE_TOTAL_SETTING, CHILL_SETTING,
      BAKE_SETTING, WAIT_WEIGHT_SETTING, BUFFER_MAX_SETTING,
    ]));
  const m = new Map(rows.map(r => [r.key, r.value]));
  const num = (key: string, dflt: number) => {
    const v = Number(m.get(key));
    return m.has(key) && m.get(key) !== "" && Number.isFinite(v) && v >= 0 ? v : dflt;
  };
  return {
    learningEnabled: (m.get(LEARNING_ENABLED_SETTING) ?? "true") !== "false",
    lastAutoRun: m.get(LAST_AUTO_RUN_SETTING) ?? null,
    safeTotalMinutes: num(SAFE_TOTAL_SETTING, DEFAULT_SAFETY_RULE.totalMinutes),
    chillMinutes: num(CHILL_SETTING, DEFAULT_SAFETY_RULE.chillMinutes),
    bakeMinutesOverride: m.has(BAKE_SETTING) && m.get(BAKE_SETTING) !== "" ? num(BAKE_SETTING, DEFAULT_SAFETY_RULE.bakeMinutes) : null,
    waitWeight: num(WAIT_WEIGHT_SETTING, LEARNING_RULES.waitWeight),
    bufferMaxMinutes: num(BUFFER_MAX_SETTING, LEARNING_RULES.bufferMax),
  };
}

export function rulesFromSettings(s: MeatTimingSettings): LearningRules {
  return { ...LEARNING_RULES, waitWeight: s.waitWeight, bufferMax: Math.max(LEARNING_RULES.bufferMin, s.bufferMaxMinutes) };
}

/**
 * Last calzone batch built → out of the calzone oven, minutes: the 90th
 * percentile over the last 60 days of the ovens station's last batch of each
 * recipe after the builders' last batch. Null with too little data.
 */
export async function learnedBakeMinutes(): Promise<{ minutes: number | null; samples: number }> {
  const res = await db.execute<{ p90: number | null; n: number }>(sql`
    WITH b AS (
      SELECT pi.plan_id, pi.recipe_id,
        max(bc.completed_at) FILTER (WHERE bc.station_type IN ('building_1','building_2')) AS last_build,
        max(bc.completed_at) FILTER (WHERE bc.station_type = 'ovens') AS last_oven
      FROM batch_completions bc
      JOIN production_plan_items pi ON pi.id = bc.plan_item_id
      JOIN production_plans p ON p.id = pi.plan_id
      WHERE p.plan_date >= (CURRENT_DATE - 60)
      GROUP BY 1, 2
    )
    SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM last_oven - last_build) / 60) AS p90,
           count(*)::int AS n
      FROM b WHERE last_build IS NOT NULL AND last_oven > last_build
       AND last_oven - last_build < interval '2 hours'
  `);
  const row = res.rows[0];
  const n = Number(row?.n ?? 0);
  return { minutes: n >= 10 && row?.p90 != null ? Math.round(Number(row.p90)) : null, samples: n };
}

/**
 * Chill time as RECORDED (calzone chill timer, batch_weight_records): the
 * last batch's chill end after its last oven pass, median over 60 days. For
 * information — "chilling finished" is a tap (and is auto-stamped at wrapping
 * on some days), so it runs late; planning uses the Settings chill time.
 */
export async function recordedChillMinutes(): Promise<{ median: number | null; samples: number }> {
  const res = await db.execute<{ med: number | null; n: number }>(sql`
    WITH b AS (
      SELECT pi.plan_id, pi.recipe_id, max(bc.completed_at) FILTER (WHERE bc.station_type = 'ovens') AS last_oven
      FROM batch_completions bc JOIN production_plan_items pi ON pi.id = bc.plan_item_id
      GROUP BY 1, 2
    ), c AS (
      SELECT plan_id, recipe_id, max(chill_end_at) AS last_chill
      FROM batch_weight_records
      WHERE chill_end_at IS NOT NULL AND chilled_via <> 'wrapping_complete_auto'
        AND recorded_at >= now() - interval '60 days'
      GROUP BY 1, 2
    )
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM c.last_chill - b.last_oven) / 60) AS med,
           count(*)::int AS n
      FROM b JOIN c USING (plan_id, recipe_id) WHERE c.last_chill > b.last_oven
  `);
  const row = res.rows[0];
  return { median: row?.med != null ? Math.round(Number(row.med)) : null, samples: Number(row?.n ?? 0) };
}

/** The 4-hour rule as configured now: total, chill, and bake (override, else learned, else 15). */
export async function loadSafetyRule(settings?: MeatTimingSettings): Promise<SafetyRule & { bakeSource: "setting" | "learned" | "default" }> {
  const s = settings ?? await loadMeatTimingSettings();
  if (s.bakeMinutesOverride != null) {
    return { totalMinutes: s.safeTotalMinutes, chillMinutes: s.chillMinutes, bakeMinutes: s.bakeMinutesOverride, bakeSource: "setting" };
  }
  const learned = await learnedBakeMinutes();
  return {
    totalMinutes: s.safeTotalMinutes,
    chillMinutes: s.chillMinutes,
    bakeMinutes: learned.minutes ?? DEFAULT_SAFETY_RULE.bakeMinutes,
    bakeSource: learned.minutes != null ? "learned" : "default",
  };
}

export async function saveSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
}

type RunRow = {
  ingredient_id: number;
  plan_id: number;
  recipe_id: number;
  plan_date: string;
  trays: Array<{ in: number; out: number | null; probe: number | null }>;
  filling_ready_ms: number | null;
  need_error: number | null;
};

/**
 * One row per raw meat × recipe × plan: its oven trays (with the probe
 * reading at temperature), the first tin of that recipe's filling mixed, and
 * — from the daily review — how wrong the builders' predicted time was.
 * Timestamps are UTC wall-clock (timestamp without time zone, written by a
 * UTC server), so epoch maths on them is exact.
 */
export async function loadRuns(ingredientIds?: number[]): Promise<Map<number, MeatRun[]>> {
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const idFilter = ingredientIds && ingredientIds.length
    ? sql`AND o.ingredient_id IN (${sql.join(ingredientIds.map(i => sql`${i}`), sql`, `)})`
    : sql``;
  const result = await db.execute<RunRow>(sql`
    SELECT o.ingredient_id, o.plan_id, o.recipe_id, p.plan_date::text AS plan_date,
      json_agg(json_build_object(
        'in', extract(epoch FROM o.oven_in_at) * 1000,
        'out', extract(epoch FROM o.oven_out_at) * 1000,
        'probe', extract(epoch FROM (
          SELECT min(t.recorded_at) FROM temperature_records t
           WHERE t.plan_id = o.plan_id AND t.recipe_id = o.recipe_id
             AND t.ingredient_id = o.ingredient_id AND t.tray_index = o.tray_index
             AND t.record_type = 'cooked_core' AND t.recorded_at >= o.oven_in_at
        )) * 1000
      )) AS trays,
      (SELECT extract(epoch FROM min(bc.completed_at)) * 1000
         FROM batch_completions bc
         JOIN production_plan_items pi ON pi.id = bc.plan_item_id
        WHERE pi.plan_id = o.plan_id AND pi.recipe_id = o.recipe_id
          AND bc.station_type = 'mixing') AS filling_ready_ms,
      (SELECT r.predicted_need_minutes - r.needed_at_minutes FROM meat_put_in_records r
        WHERE r.plan_id = o.plan_id AND r.recipe_id = o.recipe_id AND r.ingredient_id = o.ingredient_id) AS need_error
    FROM oven_events o
    JOIN production_plans p ON p.id = o.plan_id
    WHERE o.ingredient_id IS NOT NULL AND o.recipe_id IS NOT NULL
      AND p.plan_date >= ${since}
      ${idFilter}
    GROUP BY o.ingredient_id, o.plan_id, o.recipe_id, p.plan_date
  `);
  const out = new Map<number, MeatRun[]>();
  for (const r of result.rows) {
    const trays: MeatTrayEvent[] = (r.trays ?? []).map(t => ({
      inAtMs: Number(t.in),
      outAtMs: t.out == null ? null : Number(t.out),
      probeAtMs: t.probe == null ? null : Number(t.probe),
    }));
    const list = out.get(Number(r.ingredient_id)) ?? [];
    list.push({
      planId: Number(r.plan_id),
      recipeId: Number(r.recipe_id),
      planDate: r.plan_date,
      trays,
      fillingReadyAtMs: r.filling_ready_ms == null ? null : Number(r.filling_ready_ms),
      needErrorMinutes: r.need_error == null ? null : Number(r.need_error),
    });
    out.set(Number(r.ingredient_id), list);
  }
  return out;
}

export interface MeatTimingReportRow {
  ingredientId: number;
  name: string;
  cookMinutes: number | null;
  processMinutes: number | null;
  bufferMinutes: number | null;
  autoLearn: boolean;
  configuredLeadMinutes: number | null;
  learning: MeatLearning;
  /** From the daily review: "Trusted ✓" and the recent outcomes. */
  trust: TrustSignal;
  /** Team habitually puts this in early/late — those runs count for learning. */
  habit: "early" | "late" | null;
  review: ReviewStats | null;
}

/** Every raw meat with a cook or process time, or prep-oven history. */
export async function buildMeatTimingReport(): Promise<MeatTimingReportRow[]> {
  const settings = await loadMeatTimingSettings();
  const rules = rulesFromSettings(settings);
  const runs = await loadRuns();
  const meats = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      category: ingredientsTable.category,
      cook: ingredientsTable.estimatedCookTimeMin,
      process: ingredientsTable.meatProcessMinutes,
      buffer: ingredientsTable.meatBufferMinutes,
      autoLearn: ingredientsTable.meatTimingAutoLearn,
    })
    .from(ingredientsTable);
  const shown = meats.filter(m => runs.has(m.id) || (m.category === "raw_meat" && (m.cook != null || m.process != null)));
  const ids = shown.map(m => m.id);
  // The daily review decides which runs the learning may use (followed vs
  // not followed) and gives each meat its trust signal. Imported lazily:
  // the review job reaches back here for settings.
  const review = await import("./meat-daily-review-job");
  const [exclusions, trust, stats] = await Promise.all([
    review.learningExclusions(ids), review.trustByIngredient(ids), review.reviewStatsByIngredient(ids),
  ]);
  return shown
    .map(m => {
      const configured = { cookMinutes: m.cook, processMinutes: m.process, bufferMinutes: m.buffer };
      const ex = exclusions.get(m.id);
      return {
        ingredientId: m.id,
        name: m.name,
        cookMinutes: m.cook,
        processMinutes: m.process,
        bufferMinutes: m.buffer,
        autoLearn: m.autoLearn,
        configuredLeadMinutes: configuredLead(configured, rules),
        learning: learnMeatTiming(runs.get(m.id) ?? [], configured, rules, ex?.exclude),
        trust: trust.get(m.id) ?? { score: null, days: 0, trusted: false, recent: [] },
        habit: ex?.habit ?? null,
        review: stats.get(m.id) ?? null,
      };
    })
    .sort((a, b) => b.learning.runsSeen - a.learning.runsSeen || a.name.localeCompare(b.name));
}

export interface AppliedChange {
  ingredientId: number;
  name: string;
  field: "process" | "buffer";
  from: number | null;
  to: number;
}

/**
 * Apply every recommended change for meats with learning switched on.
 * Each meat's update is guarded on the values it was learned from, so a
 * manager's edit in the meantime is never overwritten.
 */
export async function applyLearnedTimings(
  actor: { userId: number | null; name: string } | null,
): Promise<AppliedChange[]> {
  const report = await buildMeatTimingReport();
  const applied: AppliedChange[] = [];
  for (const row of report) {
    if (!row.autoLearn || row.learning.changes.length === 0) continue;
    const proc = row.learning.changes.find(c => c.field === "process");
    const buffer = row.learning.changes.find(c => c.field === "buffer");
    await db.transaction(async (tx) => {
      const set: { meatProcessMinutes?: number; meatBufferMinutes?: number } = {};
      if (proc) set.meatProcessMinutes = proc.to;
      if (buffer) set.meatBufferMinutes = buffer.to;
      const updated = await tx
        .update(ingredientsTable)
        .set(set)
        .where(and(
          eq(ingredientsTable.id, row.ingredientId),
          eq(ingredientsTable.meatTimingAutoLearn, true),
          sql`${ingredientsTable.meatProcessMinutes} IS NOT DISTINCT FROM ${row.processMinutes}`,
          sql`${ingredientsTable.meatBufferMinutes} IS NOT DISTINCT FROM ${row.bufferMinutes}`,
        ))
        .returning({ id: ingredientsTable.id });
      if (updated.length === 0) return; // changed under us — next run re-learns
      for (const c of [proc, buffer]) {
        if (!c) continue;
        await tx.insert(meatTimingAdjustmentsTable).values({
          ingredientId: row.ingredientId,
          ingredientName: row.name,
          field: c.field,
          oldValue: c.from,
          newValue: c.to,
          source: "auto",
          reason: c.reason,
          runsUsed: row.learning.runsUsed,
          processMedianMinutes: row.learning.processing ? row.learning.processing.median.toFixed(1) : null,
          processSlowMinutes: row.learning.processing ? row.learning.processing.slow.toFixed(1) : null,
          actorUserId: actor?.userId ?? null,
          actorName: actor ? `${actor.name} (ran the learning now)` : "Automatic learning",
        });
        applied.push({ ingredientId: row.ingredientId, name: row.name, field: c.field, from: c.from, to: c.to });
      }
    });
  }
  return applied;
}

export async function listAdjustments(limit = 60) {
  return db
    .select()
    .from(meatTimingAdjustmentsTable)
    .orderBy(desc(meatTimingAdjustmentsTable.createdAt), desc(meatTimingAdjustmentsTable.id))
    .limit(limit);
}

export type RevertResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Put a change back. Only the newest un-reverted change to that field can be
 * reverted (otherwise the "old value" would skip a later change). Reverting
 * an automatic change turns learning off for that meat so it isn't simply
 * re-applied tomorrow.
 */
export async function revertAdjustment(id: number, actor: { userId: number | null; name: string }): Promise<RevertResult> {
  return db.transaction(async (tx) => {
    const [adj] = await tx.select().from(meatTimingAdjustmentsTable).where(eq(meatTimingAdjustmentsTable.id, id)).limit(1);
    if (!adj || adj.source === "revert") return { ok: false, status: 404, error: "Change not found" } as const;
    if (adj.revertedAt) return { ok: false, status: 409, error: "Already reverted" } as const;
    const [newer] = await tx
      .select({ id: meatTimingAdjustmentsTable.id })
      .from(meatTimingAdjustmentsTable)
      .where(and(
        eq(meatTimingAdjustmentsTable.ingredientId, adj.ingredientId),
        eq(meatTimingAdjustmentsTable.field, adj.field),
        isNull(meatTimingAdjustmentsTable.revertedAt),
        sql`${meatTimingAdjustmentsTable.source} <> 'revert'`,
        sql`${meatTimingAdjustmentsTable.id} > ${adj.id}`,
      ))
      .limit(1);
    if (newer) return { ok: false, status: 409, error: "A newer change to this value exists — revert that one first" } as const;

    const column = adj.field === "process" ? ingredientsTable.meatProcessMinutes : ingredientsTable.meatBufferMinutes;
    const [ing] = await tx.select({ current: column }).from(ingredientsTable).where(eq(ingredientsTable.id, adj.ingredientId)).limit(1);
    if (!ing) return { ok: false, status: 404, error: "Ingredient not found" } as const;

    await tx
      .update(ingredientsTable)
      .set(adj.field === "process"
        ? { meatProcessMinutes: adj.oldValue, meatTimingAutoLearn: false }
        : { meatBufferMinutes: adj.oldValue, meatTimingAutoLearn: false })
      .where(eq(ingredientsTable.id, adj.ingredientId));
    await tx
      .update(meatTimingAdjustmentsTable)
      .set({ revertedAt: new Date(), revertedByName: actor.name })
      .where(eq(meatTimingAdjustmentsTable.id, adj.id));
    await tx.insert(meatTimingAdjustmentsTable).values({
      ingredientId: adj.ingredientId,
      ingredientName: adj.ingredientName,
      field: adj.field,
      oldValue: ing.current,
      newValue: adj.oldValue ?? 0,
      source: "revert",
      reason: `Reverted change #${adj.id}; learning paused for this meat until switched back on.`,
      actorUserId: actor.userId,
      actorName: actor.name,
    });
    return { ok: true } as const;
  });
}

/** A manager setting processing / buffer / learning by hand — logged like the rest. */
export async function setMeatTiming(
  ingredientId: number,
  body: { processMinutes?: number; bufferMinutes?: number; autoLearn?: boolean },
  actor: { userId: number | null; name: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [ing] = await tx
      .select({ name: ingredientsTable.name, process: ingredientsTable.meatProcessMinutes, buffer: ingredientsTable.meatBufferMinutes })
      .from(ingredientsTable)
      .where(eq(ingredientsTable.id, ingredientId))
      .limit(1);
    if (!ing) return false;
    const set: { meatProcessMinutes?: number; meatBufferMinutes?: number; meatTimingAutoLearn?: boolean } = {};
    if (body.processMinutes !== undefined) set.meatProcessMinutes = body.processMinutes;
    if (body.bufferMinutes !== undefined) set.meatBufferMinutes = body.bufferMinutes;
    if (body.autoLearn !== undefined) set.meatTimingAutoLearn = body.autoLearn;
    if (Object.keys(set).length === 0) return true;
    await tx.update(ingredientsTable).set(set).where(eq(ingredientsTable.id, ingredientId));
    const log = (field: "process" | "buffer", from: number | null, to: number | undefined) => {
      if (to === undefined || to === from) return null;
      return tx.insert(meatTimingAdjustmentsTable).values({
        ingredientId, ingredientName: ing.name, field, oldValue: from, newValue: to,
        source: "manual", reason: "Set by hand.", actorUserId: actor.userId, actorName: actor.name,
      });
    };
    await log("process", ing.process, body.processMinutes);
    await log("buffer", ing.buffer, body.bufferMinutes);
    return true;
  });
}
