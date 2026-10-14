/**
 * Team efficiency — which stored days to recheck this hour (Objective I).
 *
 * A day stored as 'pending' is waiting for Planday shifts to be approved.
 * The nightly run recomputes the recent window once, at ~02:00; shifts
 * approved after that would otherwise sit as pending until the next night.
 * So every hourly tick rechecks JUST the pending days in the recent window,
 * at most once an hour. Pure: the job reads the rows and the last run time.
 */
import { addDaysIso } from "./team-efficiency-labour";

export const RECHECK_MIN_INTERVAL_MS = 55 * 60_000; // hourly tick, with a little slack

export interface StoredDayStatus {
  date: string;   // YYYY-MM-DD
  status: string; // 'ok' | 'pending' | 'excluded' | 'no_labour'
}

export interface RecheckInput {
  days: StoredDayStatus[];
  today: string;                // London YYYY-MM-DD
  windowDays: number;           // the nightly recent window (days before today)
  now: Date;
  lastRecheckAt: string | null; // ISO, from job state
  minIntervalMs?: number;
}

export interface RecheckPlan {
  dates: string[]; // sorted, unique
  from: string;
  to: string;
}

/** The pending days to recompute now, or null when there's nothing to do
 *  (no pending days in the window, or rechecked within the last hour). */
export function pendingDaysToRecheck(input: RecheckInput): RecheckPlan | null {
  const minInterval = input.minIntervalMs ?? RECHECK_MIN_INTERVAL_MS;
  if (input.lastRecheckAt) {
    const last = Date.parse(input.lastRecheckAt);
    if (Number.isFinite(last) && input.now.getTime() - last < minInterval) return null;
  }
  const from = addDaysIso(input.today, -input.windowDays);
  const to = addDaysIso(input.today, -1);
  const dates = [...new Set(
    input.days
      .filter(d => d.status === "pending" && d.date >= from && d.date <= to)
      .map(d => d.date),
  )].sort();
  if (dates.length === 0) return null;
  return { dates, from: dates[0], to: dates[dates.length - 1] };
}
