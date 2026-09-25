/**
 * One person's attendance over a rolling window, and whether the sickness
 * policy's review trigger is reached (Graeme, 2026-09-25 People redesign).
 *
 * The policy (Sickness & Absence policy in the Documents repository): FOUR
 * sickness instances or SIX lates in a rolling 12 months → a review meeting.
 * Sickness instances count sickness only (sickRuns — a run of sick days is
 * one instance until a worked shift breaks it); other absences (Absent,
 * dependants' or emergency leave) get their own count and never feed the
 * sickness trigger.
 *
 * Pure: the caller loads the shifts; tests pin every rule.
 */
import { isLateName, isSickName, needsReturnToWorkForm, sickRuns } from "../services/attendance-classify";
import { absenceRuns, isWorkedShift, type ClassifiedShift } from "./absence-spells";

export const ATTENDANCE_POLICY = {
  /** Sickness instances in the window that trigger a review. */
  sickInstances: 4,
  /** Lates in the window that trigger a review. */
  lates: 6,
  /** Rolling window, in months. */
  months: 12,
} as const;

/** The same calendar day `months` months before `todayIso` (clamped to the
 *  month's last day), plus one day — so the window is exactly 12 months. */
export function rollingWindowStart(todayIso: string, months: number = ATTENDANCE_POLICY.months): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  const targetMonthIndex = (m - 1) - months;
  const ty = y + Math.floor(targetMonthIndex / 12);
  const tm = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const start = new Date(Date.UTC(ty, tm, Math.min(d, lastDay)));
  start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString().slice(0, 10);
}

export interface AttendanceSummary {
  windowStart: string;
  windowEnd: string;
  sickInstances: number;
  sickDays: number;
  lates: number;
  /** Days of non-sickness absence (Absent, dependants' / emergency leave). */
  otherAbsenceDays: number;
  /** Spells of non-sickness absence. */
  otherAbsenceSpells: number;
  triggers: {
    sickness: boolean;
    lates: boolean;
  };
  policy: typeof ATTENDANCE_POLICY;
}

export function summariseAttendance(shifts: readonly ClassifiedShift[], todayIso: string): AttendanceSummary {
  const windowStart = rollingWindowStart(todayIso);
  const inWindow = shifts.filter(s => {
    const d = s.date.slice(0, 10);
    return d >= windowStart && d <= todayIso;
  });

  const sickDates: string[] = [];
  const worked: string[] = [];
  let lates = 0; // per late shift, as the Employee Records report counts them
  const otherAbsence: ClassifiedShift[] = [];
  for (const s of inWindow) {
    const d = s.date.slice(0, 10);
    if (s.typeName != null && isSickName(s.typeName)) sickDates.push(d);
    else if (s.typeName != null && needsReturnToWorkForm(s.typeName)) otherAbsence.push(s);
    if (s.typeName != null && isLateName(s.typeName)) lates += 1;
    if (isWorkedShift(s)) worked.push(d);
  }

  const sickInstances = sickRuns(sickDates, worked).length;
  const otherDays = new Set(otherAbsence.map(s => s.date.slice(0, 10))).size;
  // Other-absence spells: the same run rule, over the non-sick days only.
  const otherSpells = absenceRuns([...otherAbsence, ...worked.map(date => ({ date, typeName: null }))]).length;

  return {
    windowStart,
    windowEnd: todayIso,
    sickInstances,
    sickDays: new Set(sickDates).size,
    lates,
    otherAbsenceDays: otherDays,
    otherAbsenceSpells: otherSpells,
    triggers: {
      sickness: sickInstances >= ATTENDANCE_POLICY.sickInstances,
      lates: lates >= ATTENDANCE_POLICY.lates,
    },
    policy: ATTENDANCE_POLICY,
  };
}
