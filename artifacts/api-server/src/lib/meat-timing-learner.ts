/**
 * Self-correcting prep-oven timings — the database side (Graeme, 2026-10-27).
 * The maths is @workspace/production-schedule meat-timing-learning.ts (pure,
 * tested); this loads the floor history, applies the changes it recommends,
 * logs every one in meat_timing_adjustments (migration 0290) and reverts them.
 *
 * AUTOMATIC, because Graeme asked for it ("could you build an automatic
 * system that self-corrects") and the team never managed to keep these
 * numbers right by hand. It is safe to automate because:
 *   - only processing and grace move — never the cook time or a temperature;
 *   - each run moves a value at most 15 minutes, on at least 5 clean runs;
 *   - grace is capped at 30 minutes;
 *   - every change is logged with its evidence, shown to managers, and can be
 *     reverted; reverting switches learning off for that meat until a manager
 *     turns it back on;
 *   - the whole thing has an off switch (meat_timing_learning_enabled).
 */
import { db, ingredientsTable, meatTimingAdjustmentsTable, appSettingsTable } from "@workspace/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  learnMeatTiming, configuredLead, LEARNING_RULES,
  type MeatRun, type MeatLearning, type MeatTrayEvent, type TrustSignal,
} from "@workspace/production-schedule";

type ReviewStats = Awaited<ReturnType<typeof import("./meat-daily-review-job").reviewStatsByIngredient>> extends Map<number, infer V> ? V : never;

/** Look back this far for runs; the learner itself uses the newest 20 clean ones. */
export const HISTORY_DAYS = 120;
export const MAX_HOLD_SETTING = "cooked_meat_max_hold_minutes";
export const LEARNING_ENABLED_SETTING = "meat_timing_learning_enabled";
export const LAST_AUTO_RUN_SETTING = "meat_timing_last_auto_run";
export const MIX_READY_SETTING = "mix_ready_before_minutes";
export const HOT_READY_SETTING = "hot_mix_ready_before_minutes";
export const DEFAULT_MIX_READY_MINUTES = 10;
export const DEFAULT_HOT_READY_MINUTES = 20;
/** The 4-hour rule less a 30-minute margin. */
export const DEFAULT_MAX_HOLD_MINUTES = 210;

export interface MeatTimingSettings {
  maxHoldMinutes: number;
  learningEnabled: boolean;
  lastAutoRun: string | null;
  /** Every mix ready this long before the builders need it. */
  mixReadyBeforeMinutes: number;
  /** Hot meat ready this long before it's needed — the schedule's buffer and the review's target. */
  hotReadyBeforeMinutes: number;
}

export async function loadMeatTimingSettings(): Promise<MeatTimingSettings> {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, [MAX_HOLD_SETTING, LEARNING_ENABLED_SETTING, LAST_AUTO_RUN_SETTING, MIX_READY_SETTING, HOT_READY_SETTING]));
  const m = new Map(rows.map(r => [r.key, r.value]));
  const hold = Number(m.get(MAX_HOLD_SETTING));
  const num = (key: string, dflt: number) => {
    const v = Number(m.get(key));
    return m.has(key) && Number.isFinite(v) && v >= 0 ? v : dflt;
  };
  return {
    maxHoldMinutes: Number.isFinite(hold) && hold > 0 ? hold : DEFAULT_MAX_HOLD_MINUTES,
    learningEnabled: (m.get(LEARNING_ENABLED_SETTING) ?? "true") !== "false",
    lastAutoRun: m.get(LAST_AUTO_RUN_SETTING) ?? null,
    mixReadyBeforeMinutes: num(MIX_READY_SETTING, DEFAULT_MIX_READY_MINUTES),
    hotReadyBeforeMinutes: num(HOT_READY_SETTING, DEFAULT_HOT_READY_MINUTES),
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
  trays: Array<{ in: number; out: number | null }>;
  filling_ready_ms: number | null;
};

/**
 * One row per raw meat × recipe × plan: its oven trays and the first tin of
 * that recipe's filling mixed. Timestamps are stored as UTC wall-clock
 * (timestamp without time zone, written by a UTC server), so epoch maths on
 * them is exact.
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
        -- The core-temperature probe reading is objective; the "out" tap is
        -- often pressed late. Prefer the probe when there is one.
        'out', extract(epoch FROM COALESCE((
          SELECT min(t.recorded_at) FROM temperature_records t
           WHERE t.plan_id = o.plan_id AND t.recipe_id = o.recipe_id
             AND t.ingredient_id = o.ingredient_id AND t.tray_index = o.tray_index
             AND t.record_type = 'cooked_core' AND t.recorded_at >= o.oven_in_at
        ), o.oven_out_at)) * 1000
      )) AS trays,
      (SELECT extract(epoch FROM min(bc.completed_at)) * 1000
         FROM batch_completions bc
         JOIN production_plan_items pi ON pi.id = bc.plan_item_id
        WHERE pi.plan_id = o.plan_id AND pi.recipe_id = o.recipe_id
          AND bc.station_type = 'mixing') AS filling_ready_ms
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
    }));
    const list = out.get(Number(r.ingredient_id)) ?? [];
    list.push({
      planId: Number(r.plan_id),
      recipeId: Number(r.recipe_id),
      planDate: r.plan_date,
      trays,
      fillingReadyAtMs: r.filling_ready_ms == null ? null : Number(r.filling_ready_ms),
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
  graceMinutes: number | null;
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
  const runs = await loadRuns();
  const meats = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      category: ingredientsTable.category,
      cook: ingredientsTable.estimatedCookTimeMin,
      process: ingredientsTable.meatProcessMinutes,
      grace: ingredientsTable.meatGraceMinutes,
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
      const configured = { cookMinutes: m.cook, processMinutes: m.process, graceMinutes: m.grace };
      const ex = exclusions.get(m.id);
      return {
        ingredientId: m.id,
        name: m.name,
        cookMinutes: m.cook,
        processMinutes: m.process,
        graceMinutes: m.grace,
        autoLearn: m.autoLearn,
        configuredLeadMinutes: configuredLead(configured),
        learning: learnMeatTiming(runs.get(m.id) ?? [], configured, LEARNING_RULES, ex?.exclude),
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
  field: "process" | "grace";
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
    const grace = row.learning.changes.find(c => c.field === "grace");
    await db.transaction(async (tx) => {
      const set: { meatProcessMinutes?: number; meatGraceMinutes?: number } = {};
      if (proc) set.meatProcessMinutes = proc.to;
      if (grace) set.meatGraceMinutes = grace.to;
      const updated = await tx
        .update(ingredientsTable)
        .set(set)
        .where(and(
          eq(ingredientsTable.id, row.ingredientId),
          eq(ingredientsTable.meatTimingAutoLearn, true),
          sql`${ingredientsTable.meatProcessMinutes} IS NOT DISTINCT FROM ${row.processMinutes}`,
          sql`${ingredientsTable.meatGraceMinutes} IS NOT DISTINCT FROM ${row.graceMinutes}`,
        ))
        .returning({ id: ingredientsTable.id });
      if (updated.length === 0) return; // changed under us — next run re-learns
      for (const c of [proc, grace]) {
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
          leadMedianMinutes: row.learning.lead ? row.learning.lead.median.toFixed(1) : null,
          leadSlowMinutes: row.learning.lead ? row.learning.lead.slow.toFixed(1) : null,
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

    const column = adj.field === "process" ? ingredientsTable.meatProcessMinutes : ingredientsTable.meatGraceMinutes;
    const [ing] = await tx.select({ current: column }).from(ingredientsTable).where(eq(ingredientsTable.id, adj.ingredientId)).limit(1);
    if (!ing) return { ok: false, status: 404, error: "Ingredient not found" } as const;

    await tx
      .update(ingredientsTable)
      .set(adj.field === "process"
        ? { meatProcessMinutes: adj.oldValue, meatTimingAutoLearn: false }
        : { meatGraceMinutes: adj.oldValue, meatTimingAutoLearn: false })
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

/** A manager setting processing / grace / learning by hand — logged like the rest. */
export async function setMeatTiming(
  ingredientId: number,
  body: { processMinutes?: number; graceMinutes?: number; autoLearn?: boolean },
  actor: { userId: number | null; name: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [ing] = await tx
      .select({ name: ingredientsTable.name, process: ingredientsTable.meatProcessMinutes, grace: ingredientsTable.meatGraceMinutes })
      .from(ingredientsTable)
      .where(eq(ingredientsTable.id, ingredientId))
      .limit(1);
    if (!ing) return false;
    const set: { meatProcessMinutes?: number; meatGraceMinutes?: number; meatTimingAutoLearn?: boolean } = {};
    if (body.processMinutes !== undefined) set.meatProcessMinutes = body.processMinutes;
    if (body.graceMinutes !== undefined) set.meatGraceMinutes = body.graceMinutes;
    if (body.autoLearn !== undefined) set.meatTimingAutoLearn = body.autoLearn;
    if (Object.keys(set).length === 0) return true;
    await tx.update(ingredientsTable).set(set).where(eq(ingredientsTable.id, ingredientId));
    const log = (field: "process" | "grace", from: number | null, to: number | undefined) => {
      if (to === undefined || to === from) return null;
      return tx.insert(meatTimingAdjustmentsTable).values({
        ingredientId, ingredientName: ing.name, field, oldValue: from, newValue: to,
        source: "manual", reason: "Set by hand.", actorUserId: actor.userId, actorName: actor.name,
      });
    };
    await log("process", ing.process, body.processMinutes);
    await log("grace", ing.grace, body.graceMinutes);
    return true;
  });
}
