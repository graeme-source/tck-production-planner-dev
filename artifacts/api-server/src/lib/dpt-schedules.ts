/**
 * Scheduled DPT rules (Graeme, 2026-10-26) — a recipe leaving the one-time
 * menu keeps being made for its subscription orders plus a little buffer:
 * "orders + up to N batches a day" from a start date. Migration 0264.
 *
 * Applied by the PLAN date (a Monday plan made on Thursday follows Monday's
 * rule). The cap itself is in the shared solver (@workspace/plan-margin
 * extraBatchesCap), so Create Plan's server maths and the screen agree.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

import { capsForDate, type DptCap, type DptScheduleRow } from "./dpt-schedule-rules";
export { capsForDate, type DptCap, type DptScheduleRow };

export async function loadDptSchedules(): Promise<DptScheduleRow[]> {
  const rows = await db.execute<{ id: number; recipe_id: number; starts_on: string; ends_on: string | null; extra_batches: number; reason: string | null; ended_at: Date | string | null }>(sql`
    SELECT id, recipe_id, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on,
           extra_batches, reason, ended_at
      FROM dpt_schedules ORDER BY starts_on, id
  `);
  return rows.rows.map(r => ({
    id: Number(r.id), recipeId: Number(r.recipe_id), startsOn: r.starts_on, endsOn: r.ends_on,
    extraBatches: Number(r.extra_batches), reason: r.reason,
    endedAt: r.ended_at == null ? null : new Date(r.ended_at).toISOString(),
  }));
}

/** Caps for one plan date. A failure never stops a plan being made — it
 *  just plans without the rules (and says so in the log). */
export async function loadDptCapsForDate(planDate: string): Promise<Map<number, DptCap>> {
  try {
    return capsForDate(await loadDptSchedules(), planDate);
  } catch (err) {
    console.error("[dpt-schedules] couldn't load scheduled rules — planning without them:", err);
    return new Map();
  }
}
