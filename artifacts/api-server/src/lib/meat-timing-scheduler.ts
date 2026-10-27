/**
 * Daily self-correcting prep-oven timings (Graeme, 2026-10-27). Hourly tick:
 *   1. the daily review (lib/meat-daily-review-job.ts) judges each put-in —
 *      followed or not, ready in time or not, how long it sat;
 *   2. once a day, after production (from 15:00 London), on a day the prep
 *      oven was actually used, it learns from the floor and applies the
 *      changes (lib/meat-timing-learner.ts), leaving out runs the review says
 *      weren't followed. Only on days with new oven data: the step
 * limit means re-running on the same evidence would keep nudging the values
 * without anything new having happened.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { londonDateString, londonHour } from "./london-time";
import {
  applyLearnedTimings, loadMeatTimingSettings, saveSetting, LAST_AUTO_RUN_SETTING,
} from "./meat-timing-learner";

const INTERVAL_MS = 60 * 60 * 1000;
const RUN_FROM_HOUR = 15;

async function tick(): Promise<void> {
  const guard = await db.execute<{ ok: string | null }>(sql`
    SELECT to_regclass('public.meat_timing_adjustments')::text AS ok
  `);
  if (!guard.rows[0]?.ok) return; // migration 0290 not applied yet

  const settings = await loadMeatTimingSettings();
  const today = londonDateString();
  const afterProduction = londonHour() >= RUN_FROM_HOUR;

  // 1. The daily review: judge every put-in from finished days (and today's
  //    once production is over). Idempotent — only unreviewed records.
  const { backfillPutInRecords, reviewDueRecords } = await import("./meat-daily-review-job");
  await backfillPutInRecords();
  const reviewed = await reviewDueRecords(afterProduction);
  if (reviewed) console.log(`[meat-timing] reviewed ${reviewed} put-in(s)`);

  // 2. Learning, from the reviewed runs, once a day.
  if (!settings.learningEnabled) return;
  if (settings.lastAutoRun === today || !afterProduction) return;

  const used = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
      FROM oven_events o JOIN production_plans p ON p.id = o.plan_id
     WHERE p.plan_date = ${today}
  `);
  if (!(Number(used.rows[0]?.n) > 0)) return;

  await saveSetting(LAST_AUTO_RUN_SETTING, today);
  const applied = await applyLearnedTimings(null);
  if (applied.length) {
    console.log(`[meat-timing] learned ${applied.length} change(s):`,
      applied.map(a => `${a.name} ${a.field} ${a.from ?? "unset"}→${a.to}`).join("; "));
  }
}

export function startMeatTimingScheduler(): void {
  const run = () => tick().catch(err =>
    console.warn("[meat-timing] learning run failed (will retry next hour):", err));
  setTimeout(run, 45_000);
  setInterval(run, INTERVAL_MS).unref();
}
