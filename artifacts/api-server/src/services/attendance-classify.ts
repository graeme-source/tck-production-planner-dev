/**
 * Attendance name classification (Graeme, 2026-09-14) — pure functions in
 * their own file so they're unit-testable and shared by the report route.
 *
 * The report answers "how much was someone absent, and why": sickness
 * (paid or unpaid), unexplained absence, dependants leave, emergency leave.
 * Holiday is planned time off, not absence, so holiday shift types and
 * Planday's per-employee holiday accrual accounts ("Standard Hourly
 * Accrual", "Fixed Full Time", …) never count. Keyword matching rather than
 * hard-coded exact names, so renamed or newly added Planday types classify
 * themselves.
 */

/** "Arrived late" shift types — the headline lateness metric. */
export function isLateName(name: string | undefined): boolean {
  if (!name) return false;
  return name.toLowerCase().includes("late");
}

/**
 * Does this shift type / absence account name describe a REASON someone was
 * absent? True for sickness (paid or unpaid), "Absent", and non-holiday
 * leave (dependants, emergency…). False for holiday in any form, and for
 * non-absence types (Meeting, Training, Arrived late).
 */
export function isAbsenceReasonName(name: string | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  if (n.includes("holiday")) return false;
  return n.includes("sick") || n.includes("absent") || n.includes("leave");
}

/**
 * Does a day of this shift type need a return-to-work form once the person
 * is back? Any absence REASON does — sickness, "Absent", "Dependants Leave",
 * "Emergency Leave" — so the reason is on record (Graeme, 2026-09-25: "any
 * absence should flag up on their record"). Holiday is planned time off and
 * never does; nor do Meeting, Training or "Arrived late" (a late stays a
 * timeline event with no form).
 */
export function needsReturnToWorkForm(name: string | undefined): boolean {
  if (!name) return false;
  return isAbsenceReasonName(name) && !isLateName(name);
}

/** Any sickness shift type — "Sick Leave", "Sick - paid", "Sick - unpaid".
 *  These consolidate into ONE "Sick leave" column plus an instances count
 *  (Graeme, 2026-09-14). */
export function isSickName(name: string | undefined): boolean {
  if (!name) return false;
  return name.toLowerCase().includes("sick");
}

/**
 * Count sickness INSTANCES: 10 sick days might be 3 instances — Mon–Wed off
 * sick then back Thursday is ONE instance, however many days it spanned
 * (Graeme, 2026-09-14). A run of sick days stays one instance until a shift
 * the person actually WORKED breaks it — so sick Friday, weekend off, sick
 * Monday is still one instance, while sick Monday, worked Tuesday, sick
 * Wednesday is two.
 *
 * `sickDates` and `workedDates` are ISO date strings (duplicates fine).
 */
export function countSickInstances(sickDates: string[], workedDates: string[]): number {
  return sickRuns(sickDates, workedDates).length;
}

/**
 * The instances themselves, as date ranges — one run per continuous spell of
 * sickness (see countSickInstances). Powers the sick-leave modal and the
 * return-to-work detection: a run whose last day is behind a worked shift is
 * a completed spell the person has returned from.
 */
export function sickRuns(sickDates: string[], workedDates: string[]): Array<{ start: string; end: string; days: number }> {
  if (sickDates.length === 0) return [];
  const sick = [...new Set(sickDates)].sort();
  const worked = [...new Set(workedDates)].sort();
  const runs: Array<{ start: string; end: string; days: number }> = [];
  let start = sick[0];
  let days = 1;
  for (let i = 1; i < sick.length; i++) {
    const prev = sick[i - 1];
    const cur = sick[i];
    if (worked.some(w => w > prev && w < cur)) {
      runs.push({ start, end: prev, days });
      start = cur;
      days = 1;
    } else {
      days++;
    }
  }
  runs.push({ start, end: sick[sick.length - 1], days });
  return runs;
}
