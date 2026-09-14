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
