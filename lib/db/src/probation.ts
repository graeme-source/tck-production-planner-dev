/**
 * When a probation review falls due, and when to nudge someone to book it.
 *
 * Graeme (2026-09-03): probation used to be three months and is six months
 * for everyone joining from now on, but it can differ per person — so the
 * length lives on the employee record, and the six-month default lives in
 * settings where it can be changed without a deploy. Start dates come from
 * Planday, which is where employment actually begins.
 *
 * Lorna schedules, so Lorna gets the nudge, three weeks before it is due.
 *
 * The nudge is deliberately only for people who join from here on. Everyone
 * already employed has had their probation handled outside the app — Major
 * Sarai's three-month review on 22 September was already arranged by hand —
 * and firing prompts at Lorna for arrangements that already exist would make
 * the whole thing noise on day one.
 */

/** Weeks of warning Lorna gets before a probation review is due. */
export const PROBATION_NOTICE_WEEKS = 3;

/** Used when the employee record doesn't override it. Seeded into settings. */
export const DEFAULT_PROBATION_MONTHS = 6;

/** Add whole months to a date, clamping to the end of a short month so that
 *  31 August + 6 months is 28/29 February rather than spilling into March. */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(date.getUTCDate(), lastDayOfTarget));
  return d;
}

/** The date a probation review is due: start date + the probation length. */
export function probationDueDate(hiredOn: Date, probationMonths: number): Date {
  return addMonths(hiredOn, probationMonths);
}

export interface ProbationCandidate {
  /** Employment start, from Planday. Null when Planday has no date for them. */
  hiredOn: Date | null;
  /** Their own probation length, or null to use the default. */
  probationMonths: number | null;
  /** True once a probation meeting exists for them — booked, held, whatever.
   *  Stops a second nudge for something already in hand. */
  alreadyBooked: boolean;
}

export interface ProbationPromptOptions {
  defaultMonths: number;
  /** Only nudge for people who started on or after this date. Set to the day
   *  the feature went live so existing staff, whose probations were handled
   *  by hand, are left alone. */
  promptForHiresFrom: Date;
  noticeWeeks?: number;
}

/** Should we put a "book this probation review" to-do on Lorna's list today?
 *
 *  Yes only when: we know when they started, they started recently enough to
 *  be our responsibility, nothing is booked already, and the review falls due
 *  within the notice period — including one already overdue, because a missed
 *  probation review is worse than a late nudge. */
export function needsProbationPrompt(
  candidate: ProbationCandidate,
  today: Date,
  opts: ProbationPromptOptions,
): boolean {
  if (candidate.alreadyBooked) return false;
  if (!candidate.hiredOn || Number.isNaN(candidate.hiredOn.getTime())) return false;
  if (candidate.hiredOn < opts.promptForHiresFrom) return false;

  const months = candidate.probationMonths ?? opts.defaultMonths;
  if (!Number.isFinite(months) || months <= 0) return false;

  const due = probationDueDate(candidate.hiredOn, months);
  const noticeDays = (opts.noticeWeeks ?? PROBATION_NOTICE_WEEKS) * 7;
  const daysUntilDue = Math.floor((due.getTime() - today.getTime()) / 86_400_000);
  return daysUntilDue <= noticeDays;
}
