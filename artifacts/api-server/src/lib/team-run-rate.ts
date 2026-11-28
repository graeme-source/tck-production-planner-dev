/**
 * THE TCK run rate for one production day — which batches count, when the
 * day ended, whether it is still live, and the improvement credit. Pure: the
 * database read is services/team-run-rate.ts, the maths is
 * lib/run-rate.ts computeBatchesPerHour.
 *
 * One rule, used by every surface (Graeme, 28 Nov 2026: "the same number
 * that's shown to the builders … everywhere we display it, it's always the
 * same"). Before this, the building station took today's completions on the
 * plan it was showing with no improvement credit, Analytics grouped by the
 * plan's date with the credit, and the meetings grouped by the day each
 * batch was tapped. Each was right most days and wrong on a few, so the
 * end-of-day meeting could disagree with the station.
 *
 * The rule (Objective G):
 *   - WHICH BATCHES: building-line completions (building_1, building_2) on
 *     plan items of the plans DATED that day, tapped on that same London
 *     day. A tick on a different day (catch-up taps the next morning — 27
 *     of 16,237 rows to 27 Nov 2026) is left out: its timestamp says nothing
 *     about the day's pace and would stretch the window across midnight.
 *   - MAC CHEESE AND OTHER LINES: only the calzone line counts —
 *     kitchenLine(category) === "calzone" (@workspace/production-schedule,
 *     the one place category names live), so mac cheese and fried chicken
 *     are out and a recipe with no category still counts. Recipes flagged
 *     exclude_from_kpis (cinnamon buns, migration 0202) are out.
 *   - END OF THE DAY: the "Mark building finished" press — the latest press
 *     among the day's plans that have counted batches. No press = the last
 *     batch.
 *   - LIVE: the day is today (London) and nobody has pressed finished → the
 *     window runs to now (held while paused, lib/run-rate.ts). Every other
 *     day is the finished rule. So the station, the end-of-day meeting and
 *     Analytics all show the live number while building is on, and the same
 *     settled number afterwards.
 *   - IMPROVEMENT CREDIT: the day's run-rate credit
 *     (lib/improvement-kpi-credit.ts) comes off production time, on every
 *     surface, the live station included. The rate without it is returned
 *     beside it.
 */
import { kitchenLine } from "@workspace/production-schedule";
import { computeBatchesPerHour, type BphResult, type StandardBreakConfig } from "./run-rate";
import { londonDateString } from "./london-time";

export const TEAM_RUN_RATE_STATIONS: readonly string[] = ["building_1", "building_2"];

/** One batch completion with what the rule needs to judge it. */
export interface TeamRunRateRow {
  completedAt: Date;
  stationType: string;
  planId: number;
  /** The plan's date, YYYY-MM-DD. */
  planDate: string;
  buildingFinishedAt: Date | null;
  recipeCategory: string | null;
  excludeFromKpis: boolean;
}

/** True when this completion counts towards `date`'s team run rate. */
export function countsForTeamRunRate(r: TeamRunRateRow, date: string): boolean {
  return TEAM_RUN_RATE_STATIONS.includes(r.stationType)
    && kitchenLine(r.recipeCategory) === "calzone"
    && !r.excludeFromKpis
    && String(r.planDate).slice(0, 10) === date
    && londonDateString(r.completedAt) === date;
}

export interface TeamRunRateSelection<T extends TeamRunRateRow = TeamRunRateRow> {
  date: string;
  /** The counted completions, oldest first. */
  completions: T[];
  /** The latest "Mark building finished" press among the day's plans with counted batches. */
  finishedAt: Date | null;
}

/** The completions that count for `date`, and the day's finish press. */
export function selectTeamRunRateDay<T extends TeamRunRateRow>(rows: readonly T[], date: string): TeamRunRateSelection<T> {
  const completions = rows.filter(r => countsForTeamRunRate(r, date))
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  let finishedAt: Date | null = null;
  for (const r of completions) {
    if (r.buildingFinishedAt && (!finishedAt || r.buildingFinishedAt.getTime() > finishedAt.getTime())) finishedAt = r.buildingFinishedAt;
  }
  return { date, completions, finishedAt };
}

/** Every date in the rows with at least one counted completion, oldest first. */
export function teamRunRateDates(rows: readonly TeamRunRateRow[]): string[] {
  const dates = new Set<string>();
  for (const r of rows) {
    const d = String(r.planDate).slice(0, 10);
    if (countsForTeamRunRate(r, d)) dates.add(d);
  }
  return [...dates].sort();
}

/** Live = the day is today in London and building hasn't been marked finished. */
export function isTeamRunRateLive(date: string, finishedAt: Date | null, now: Date): boolean {
  return !finishedAt && date === londonDateString(now);
}

/** The options computeBatchesPerHour gets for the day — shared with the
 *  through-the-day chart so its last step lands on the same number. */
export function teamRunRateOptions(sel: Pick<TeamRunRateSelection, "date" | "finishedAt">, now: Date, improvementMinutes: number): {
  finishedAt: Date | null;
  liveNow?: Date;
  improvementMinutes: number;
} {
  return isTeamRunRateLive(sel.date, sel.finishedAt, now)
    ? { finishedAt: null, liveNow: now, improvementMinutes }
    : { finishedAt: sel.finishedAt, improvementMinutes };
}

/** THE team run rate for a selected day. */
export function teamRunRateFromSelection(
  sel: TeamRunRateSelection,
  config: StandardBreakConfig,
  now: Date,
  improvementMinutes: number,
): BphResult {
  return computeBatchesPerHour(sel.completions.map(c => c.completedAt), config, teamRunRateOptions(sel, now, improvementMinutes));
}
