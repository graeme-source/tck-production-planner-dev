/**
 * THE batches-per-hour calculation. Every surface that shows builder BPH
 * (Analytics, the building-station KPI row, the morning meeting) must go
 * through computeBatchesPerHour so they can never disagree again — this
 * KPI was previously computed four different ways (recorded-break
 * sessions, fixed allowance keyed to 13:00, recorded-break-type
 * deductions, and a client-side session clock) and the numbers never
 * matched.
 *
 * The method, agreed 2026-07-15:
 *   - Calzone building completions only. Mac cheese is a separate product
 *     and is ignored entirely — it neither counts as a batch nor extends
 *     the window. Callers filter before passing timestamps in.
 *   - Window = first completion → last completion (or → now for the live
 *     in-day view, frozen at the last completion once the day's calzone
 *     target is met).
 *   - Deduct the STANDARD break lengths (Settings → Break / Lunch
 *     minutes; defaults 15 / 35), never the breaks staff actually
 *     recorded. A break is deducted only when the window spans it: the
 *     window starts before the break's scheduled start AND production ran
 *     past the break's scheduled end. Scheduled times come from the
 *     day-schedule defaults (morning 09:15, lunch 12:15) — so "did we
 *     build calzones after lunch?" is answered by whether the window
 *     reaches past 12:50, not by whether anyone remembered to tap the
 *     break button.
 *   - Same function for the team, each builder, and each day.
 */
import { db, appSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { DEFAULT_BREAKS } from "@workspace/production-schedule";
import { londonMinuteOfDay } from "./london-time";

export interface StandardBreak {
  /** Scheduled start, minutes since London midnight. */
  anchorMinutes: number;
  /** Standard length to deduct, minutes. */
  minutes: number;
}

export interface StandardBreakConfig {
  morning: StandardBreak;
  lunch: StandardBreak;
}

const MORNING_ANCHOR = DEFAULT_BREAKS.find(b => b.id === "morning")?.anchorMinutes ?? 9 * 60 + 15;
const LUNCH_ANCHOR = DEFAULT_BREAKS.find(b => b.id === "lunch")?.anchorMinutes ?? 12 * 60 + 15;

/** Break lengths from Settings (default_break_minutes / default_lunch_minutes), anchors from the schedule defaults. */
export async function getStandardBreakConfig(): Promise<StandardBreakConfig> {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, ["default_break_minutes", "default_lunch_minutes"]));
  const byKey = new Map(rows.map(r => [r.key, Number(r.value)]));
  const morningMinutes = byKey.get("default_break_minutes");
  const lunchMinutes = byKey.get("default_lunch_minutes");
  return {
    morning: { anchorMinutes: MORNING_ANCHOR, minutes: Number.isFinite(morningMinutes) ? morningMinutes! : 15 },
    lunch: { anchorMinutes: LUNCH_ANCHOR, minutes: Number.isFinite(lunchMinutes) ? lunchMinutes! : 35 },
  };
}

export interface BphResult {
  batches: number;
  windowStartAt: Date | null;
  windowEndAt: Date | null;
  wallClockMinutes: number;
  morningBreakDeducted: boolean;
  lunchBreakDeducted: boolean;
  breakMinutesDeducted: number;
  activeMinutes: number;
  /** null when there's no measurable window (0-1 completions). */
  batchesPerHour: number | null;
}

const EMPTY: BphResult = {
  batches: 0,
  windowStartAt: null,
  windowEndAt: null,
  wallClockMinutes: 0,
  morningBreakDeducted: false,
  lunchBreakDeducted: false,
  breakMinutesDeducted: 0,
  activeMinutes: 0,
  batchesPerHour: null,
};

/**
 * completedAts must all fall on the same London day (callers group by day
 * first). liveNow extends the window to "now" for the in-day view; while
 * now sits inside a spanned break, only the elapsed part of that break is
 * deducted so the live number holds steady instead of sagging mid-break —
 * once the break's scheduled end passes, this converges on exactly the
 * historical rule.
 */
export function computeBatchesPerHour(
  completedAts: Date[],
  config: StandardBreakConfig,
  opts: { liveNow?: Date } = {},
): BphResult {
  if (completedAts.length === 0) return EMPTY;

  let startMs = completedAts[0].getTime();
  let lastCompletionMs = startMs;
  for (const d of completedAts) {
    const t = d.getTime();
    if (t < startMs) startMs = t;
    if (t > lastCompletionMs) lastCompletionMs = t;
  }
  const endMs = Math.max(lastCompletionMs, opts.liveNow?.getTime() ?? lastCompletionMs);

  const windowStartAt = new Date(startMs);
  const windowEndAt = new Date(endMs);
  const wallClockMinutes = (endMs - startMs) / 60_000;

  const startMin = londonMinuteOfDay(windowStartAt);
  const endMin = startMin + wallClockMinutes; // immune to the window crossing midnight in bad data

  const deductionFor = (br: StandardBreak): number => {
    if (startMin >= br.anchorMinutes) return 0; // started after the break — nothing to span
    if (endMin >= br.anchorMinutes + br.minutes) return br.minutes; // produced past the break's end
    if (opts.liveNow && endMin > br.anchorMinutes) return endMin - br.anchorMinutes; // live, mid-break
    return 0;
  };

  const morningDeduction = deductionFor(config.morning);
  const lunchDeduction = deductionFor(config.lunch);
  const breakMinutesDeducted = morningDeduction + lunchDeduction;
  const activeMinutes = Math.max(0, wallClockMinutes - breakMinutesDeducted);

  return {
    batches: completedAts.length,
    windowStartAt,
    windowEndAt,
    wallClockMinutes: Math.round(wallClockMinutes),
    morningBreakDeducted: morningDeduction > 0,
    lunchBreakDeducted: lunchDeduction > 0,
    breakMinutesDeducted: Math.round(breakMinutesDeducted),
    activeMinutes: Math.round(activeMinutes),
    batchesPerHour: activeMinutes >= 1
      ? Math.round((completedAts.length / (activeMinutes / 60)) * 10) / 10
      : null,
  };
}

/** Sum day/builder results into one rate: total batches ÷ total active hours. */
export function aggregateBph(results: BphResult[]): {
  totalBatches: number;
  totalActiveMinutes: number;
  batchesPerHour: number | null;
} {
  let totalBatches = 0;
  let totalActiveMinutes = 0;
  for (const r of results) {
    totalBatches += r.batches;
    totalActiveMinutes += r.activeMinutes;
  }
  return {
    totalBatches,
    totalActiveMinutes,
    batchesPerHour: totalActiveMinutes >= 1
      ? Math.round((totalBatches / (totalActiveMinutes / 60)) * 10) / 10
      : null,
  };
}
