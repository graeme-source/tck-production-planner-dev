/**
 * How a return-to-work form talks about the absence (Graeme, 2026-09-25):
 * forms now cover ANY absence — dependants' leave, emergency leave,
 * unexplained absence — not just sickness, so "off sick" is only right when
 * it was sickness. Older forms carry no type and were all sickness.
 */

/** Types offered when a manager records an absence Planday doesn't show,
 *  or corrects the type on a form. Planday's own names ("Sick Leave",
 *  "Dependants Leave"…) also appear on forms made from a detected spell. */
export const ABSENCE_TYPE_OPTIONS = [
  "Sickness",
  "Dependants leave",
  "Emergency leave",
  "Absent (unexplained)",
  "Other",
] as const;

/** Reasons a form can record. Sickness reasons first, then the others. */
export const RTW_REASONS = [
  "Illness",
  "Injury",
  "Medical appointment / procedure",
  "Stress or mental health",
  "Caring for a dependant",
  "Family or personal emergency",
  "Other",
] as const;

export function isSicknessType(absenceType: string | null | undefined): boolean {
  if (absenceType == null || absenceType.trim() === "") return true; // pre-2026-09-25 forms
  return absenceType.split("+").every(part => /sick/i.test(part));
}

/** "off sick" or "absent — Dependants Leave". */
export function absencePhrase(absenceType: string | null | undefined): string {
  return isSicknessType(absenceType) ? "off sick" : `absent — ${absenceType!.trim()}`;
}

/** The type options for a form's select, keeping whatever it already has. */
export function absenceTypeChoices(current: string | null | undefined): string[] {
  const base: string[] = [...ABSENCE_TYPE_OPTIONS];
  if (current && !base.includes(current)) base.unshift(current);
  return base;
}
