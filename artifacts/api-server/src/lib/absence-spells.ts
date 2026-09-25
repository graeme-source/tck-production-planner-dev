/**
 * Absence spells and who owes a return-to-work form — the pure rules
 * (Graeme, 2026-09-14; any absence, not just sickness, 2026-09-25).
 *
 * A SPELL is a continuous run of absence-reason days (sickness, "Absent",
 * dependants' or emergency leave) that only a WORKED shift breaks — sick
 * Friday, weekend off, sick Monday is one spell. A spell mixing types (sick
 * Monday, dependants' leave Tuesday) is still one absence and one form.
 * The spell is DUE a form once the person is back (a worked shift after its
 * last day) and no form covers its dates.
 *
 * No database or network here — rtw-detect.ts loads the Planday mirror and
 * hands the rows in, so every rule below is unit-tested.
 */
import { isAbsenceReasonName, isSickName, needsReturnToWorkForm } from "../services/attendance-classify";

/** One shift from the Planday mirror: its date and shift-type name
 *  (null = no type = a plain worked shift). */
export interface ClassifiedShift {
  date: string;
  typeName: string | null;
}

export interface AbsenceRun {
  start: string;
  end: string;
  days: number;
  /** The Planday shift-type names in the spell, verbatim, first-seen order. */
  types: string[];
  /** Any day of it was sickness (counts toward the sickness policy). */
  sickness: boolean;
}

export interface FormCover {
  id: number;
  absenceStart: string;
  absenceEnd: string | null;
  status: string;
}

/** Where a spell stands with its return-to-work form. */
export type SpellFormState =
  /** Back, no form, recent enough to chase — the actionable one. */
  | "needed"
  /** Back, no form, but older than the chase window (history before the
   *  forms existed) — shown, offered, never counted as outstanding. */
  | "missing"
  /** Still off: the form waits until they're back (can be started early). */
  | "away"
  | "draft"
  | "signed";

export interface AbsenceSpell extends AbsenceRun {
  /** The person has a worked shift after the spell — they're back. */
  returned: boolean;
  formId: number | null;
  formStatus: string | null;
  formState: SpellFormState;
}

/** How far back an unformed spell still counts as "form needed". Matches
 *  the detection window the chase has always used. */
export const DUE_WINDOW_DAYS = 120;

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Did this shift count as WORKED? Anything that isn't an absence reason —
 *  a plain shift, a late, training, a meeting (and, as the report has always
 *  counted it, holiday) — breaks a spell and shows the person is back. */
export function isWorkedShift(s: ClassifiedShift): boolean {
  return s.typeName == null || !isAbsenceReasonName(s.typeName);
}

/** Spells of absence from one person's shifts. Duplicates and order don't matter. */
export function absenceRuns(shifts: readonly ClassifiedShift[]): AbsenceRun[] {
  const typesByDate = new Map<string, string[]>();
  const worked: string[] = [];
  for (const s of shifts) {
    const date = s.date.slice(0, 10);
    if (s.typeName != null && needsReturnToWorkForm(s.typeName)) {
      const list = typesByDate.get(date) ?? [];
      if (!list.includes(s.typeName)) list.push(s.typeName);
      typesByDate.set(date, list);
    } else if (isWorkedShift(s)) {
      worked.push(date);
    }
  }
  const dates = [...typesByDate.keys()].sort();
  if (dates.length === 0) return [];
  const workedSorted = [...new Set(worked)].sort();

  const runs: AbsenceRun[] = [];
  let cur: AbsenceRun | null = null;
  let prev: string | null = null;
  for (const date of dates) {
    const broken = prev != null && workedSorted.some(w => w > prev! && w < date);
    if (cur == null || broken) {
      if (cur) runs.push(cur);
      cur = { start: date, end: date, days: 0, types: [], sickness: false };
    }
    cur.end = date;
    cur.days += 1;
    for (const t of typesByDate.get(date) ?? []) {
      if (!cur.types.includes(t)) cur.types.push(t);
      if (isSickName(t)) cur.sickness = true;
    }
    prev = date;
  }
  if (cur) runs.push(cur);
  return runs;
}

/** The form covering a spell: any overlap of dates counts. */
export function formCovering(run: { start: string; end: string }, forms: readonly FormCover[]): FormCover | undefined {
  return forms.find(f => f.absenceStart <= run.end && (f.absenceEnd ?? f.absenceStart) >= run.start);
}

export function spellFormState(
  spell: { end: string; returned: boolean; formId: number | null; formStatus: string | null },
  todayIso: string,
): SpellFormState {
  if (spell.formId != null) return spell.formStatus === "complete" ? "signed" : "draft";
  if (!spell.returned) return "away";
  return spell.end >= addDaysIso(todayIso, -DUE_WINDOW_DAYS) ? "needed" : "missing";
}

/** Spells for one person, forms matched and each one's form state set. */
export function absenceSpells(
  shifts: readonly ClassifiedShift[],
  forms: readonly FormCover[],
  todayIso: string,
): AbsenceSpell[] {
  const worked = shifts.filter(isWorkedShift).map(s => s.date.slice(0, 10));
  return absenceRuns(shifts).map(run => {
    const form = formCovering(run, forms);
    const spell = {
      ...run,
      returned: worked.some(w => w > run.end),
      formId: form ? form.id : null,
      formStatus: form?.status ?? null,
    };
    return { ...spell, formState: spellFormState(spell, todayIso) };
  });
}

/** Spells that owe a form right now (back, no form, inside the chase window). */
export function dueSpells<S extends { formState: SpellFormState }>(spells: readonly S[]): S[] {
  return spells.filter(s => s.formState === "needed");
}

/** "Sick Leave", "Dependants Leave", "Sick Leave + Absent" — what the form
 *  records as the kind of absence, straight from Planday's names. */
export function absenceTypeLabel(types: readonly string[]): string {
  return types.length > 0 ? types.join(" + ") : "Absence";
}

/** Plain-English phrase for an absence: "off sick" when it was sickness,
 *  otherwise "absent — Dependants Leave". */
export function absencePhrase(spell: { sickness: boolean; types: readonly string[] }): string {
  if (spell.sickness && spell.types.every(t => isSickName(t))) return "off sick";
  return `absent — ${absenceTypeLabel(spell.types)}`;
}
