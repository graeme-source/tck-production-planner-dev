/**
 * THE definition of "an improvement completed on day D" — the fourth daily
 * KPI reviewed at the morning and end-of-day meetings (Objective E,
 * continuous improvement; G, glanceable status).
 *
 * Graeme, 2026-09-18: "this counts not improvement ideas, just improvements
 * that are completed." So:
 *
 *   - An IDEA (progress_status 'submitted_for_review' — logged, still to do)
 *     never counts.
 *   - The count is bucketed by done_at — the moment the person said "I've
 *     done this" (or the after-photo auto-submitted it). That's the DOING.
 *     approved_at is the manager's later sign-off, and an approval that
 *     happens two days later must not move the work into the wrong day's
 *     meeting — the meeting is about what the team did that day.
 *   - With the approval step ON, a finished improvement sits in
 *     'awaiting_approval' until a manager checks it; the work is still done,
 *     so it counts. With approval OFF it goes straight to 'complete'. Both
 *     statuses therefore count; 'rejected' does not (the claimed completion
 *     was sent back — re-doing it stamps a fresh done_at).
 *   - Legacy rows marked complete before migration 0059 have no done_at at
 *     all. Their doing-day is unknown, so they are counted on no day rather
 *     than guessed onto the wrong one.
 *
 * Pure logic only — no DB, no dates-from-now — so it can be unit-tested and
 * so both meetings (lib/yesterday-kpis.ts wraps this with the DB query) can
 * never disagree on the number.
 */

/** The progress statuses that mean the work has actually been carried out. */
export const IMPROVEMENT_DONE_STATUSES = ["awaiting_approval", "complete"] as const;

export interface ImprovementCompletionRow {
  progressStatus: string;
  doneAt: Date | null;
}

/**
 * How many of the given improvements were completed inside the window
 * [dayStart, dayEnd] (inclusive — the callers pass London-day boundaries
 * from lib/london-time, never UTC ones).
 */
export function countImprovementsCompletedInWindow(
  rows: ImprovementCompletionRow[],
  dayStart: Date,
  dayEnd: Date,
): number {
  let count = 0;
  for (const row of rows) {
    if (!(IMPROVEMENT_DONE_STATUSES as readonly string[]).includes(row.progressStatus)) continue;
    if (!row.doneAt) continue;
    const t = row.doneAt.getTime();
    if (t >= dayStart.getTime() && t <= dayEnd.getTime()) count++;
  }
  return count;
}
