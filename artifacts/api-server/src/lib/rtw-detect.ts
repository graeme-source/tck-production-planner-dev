/**
 * Loads absence from the Planday mirror and decides who owes a
 * return-to-work form (Graeme, 2026-09-14; any absence reason, not just
 * sickness, 2026-09-25). A spell is DUE once the person is back — a worked
 * shift after its last absence day — and no form covers those dates. Reads
 * the local mirror only (fast, no Planday calls); the mirror's hourly
 * trailing sync keeps it current.
 *
 * The rules themselves are pure and tested in absence-spells.ts; this file
 * only fetches rows and hands them over.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getPlandayShiftTypes } from "../services/planday";
import { isSickName, isAbsenceReasonName, isLateName, sickRuns } from "../services/attendance-classify";
import {
  absenceSpells, addDaysIso, formCovering, DUE_WINDOW_DAYS,
  type AbsenceSpell, type ClassifiedShift, type FormCover,
} from "./absence-spells";

export { dueSpells } from "./absence-spells";
export type { AbsenceSpell } from "./absence-spells";

export interface SickSpell {
  start: string;
  end: string;
  days: number;
  /** The person has a worked shift after the spell — they're back. */
  returned: boolean;
  /** id of a return_to_work_forms row covering these dates, if any. */
  formId: number | null;
  formStatus: string | null;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The default look-back: the chase window. */
function defaultFrom(): string {
  return addDaysIso(todayIso(), -DUE_WINDOW_DAYS);
}

/**
 * Every mirrored shift since `fromIso` per app user, with its shift-type
 * name resolved. Only users linked to Planday appear. Leavers are left out
 * unless `includeInactive` (a leaver's record still shows their history).
 */
export async function loadClassifiedShifts(
  appUserIds: number[] | null,
  fromIso: string,
  opts: { includeInactive?: boolean } = {},
): Promise<Map<number, ClassifiedShift[]>> {
  const out = new Map<number, ClassifiedShift[]>();
  if (appUserIds && appUserIds.length === 0) return out;
  const users = await db.execute<{ id: number; planday_employee_id: number | null }>(sql`
    SELECT id, planday_employee_id FROM app_users
    WHERE planday_employee_id IS NOT NULL
    ${opts.includeInactive ? sql`` : sql`AND is_active = TRUE`}
    ${appUserIds ? sql`AND id IN (${sql.join(appUserIds.map(i => sql`${i}`), sql`, `)})` : sql``}
  `);
  const byPlanday = new Map<number, number>();
  for (const u of users.rows) {
    if (u.planday_employee_id != null) byPlanday.set(Number(u.planday_employee_id), Number(u.id));
  }
  if (byPlanday.size === 0) return out;
  for (const appId of byPlanday.values()) out.set(appId, []);

  const shiftTypes = await getPlandayShiftTypes();
  const typeName = new Map(shiftTypes.map(t => [t.id, t.name]));

  const shifts = await db.execute<{ employee_id: number; shift_type_id: number | null; date: string }>(sql`
    SELECT employee_id, shift_type_id, date::text FROM planday_shifts_cache
    WHERE date >= ${fromIso} AND employee_id IN (${sql.join([...byPlanday.keys()].map(i => sql`${i}`), sql`, `)})
  `);
  for (const s of shifts.rows) {
    const appId = byPlanday.get(Number(s.employee_id));
    if (appId == null) continue;
    const name = s.shift_type_id != null ? typeName.get(Number(s.shift_type_id)) ?? null : null;
    out.get(appId)!.push({ date: s.date.slice(0, 10), typeName: name });
  }
  return out;
}

/** Every return-to-work form's dates + status, per user. */
export async function loadFormCovers(userIds: number[]): Promise<Map<number, FormCover[]>> {
  const out = new Map<number, FormCover[]>();
  if (userIds.length === 0) return out;
  const forms = await db.execute<{ id: number; user_id: number; absence_start: string; absence_end: string | null; status: string }>(sql`
    SELECT id, user_id, absence_start::text, absence_end::text, status FROM return_to_work_forms
    WHERE user_id IN (${sql.join(userIds.map(i => sql`${i}`), sql`, `)})
  `);
  for (const f of forms.rows) {
    const uid = Number(f.user_id);
    const list = out.get(uid) ?? [];
    list.push({ id: Number(f.id), absenceStart: f.absence_start, absenceEnd: f.absence_end, status: f.status });
    out.set(uid, list);
  }
  return out;
}

/** Absence spells (any reason) per user since `fromIso`, forms matched. */
export async function absenceSpellsForUsers(
  appUserIds: number[] | null,
  fromIso?: string,
  opts: { includeInactive?: boolean } = {},
): Promise<Map<number, AbsenceSpell[]>> {
  const shiftsByUser = await loadClassifiedShifts(appUserIds, fromIso ?? defaultFrom(), opts);
  const formsByUser = await loadFormCovers([...shiftsByUser.keys()]);
  const today = todayIso();
  const out = new Map<number, AbsenceSpell[]>();
  for (const [uid, shifts] of shiftsByUser) {
    const spells = absenceSpells(shifts, formsByUser.get(uid) ?? [], today);
    if (spells.length > 0) out.set(uid, spells);
  }
  return out;
}

export async function absenceSpellsForUser(appUserId: number, fromIso?: string): Promise<AbsenceSpell[]> {
  return (await absenceSpellsForUsers([appUserId], fromIso)).get(appUserId) ?? [];
}

/** SICK spells only, for ONE app user (empty when they have no Planday link).
 *  Feeds the Employee Records report's sick-leave modal, whose numbers are
 *  sickness only. `fromIso` widens the default trailing window — the modal
 *  passes its own date range so the instances shown match the numbers
 *  clicked (Graeme, 2026-09-14). */
export async function sickSpellsForUser(appUserId: number, fromIso?: string): Promise<SickSpell[]> {
  const shifts = (await loadClassifiedShifts([appUserId], fromIso ?? defaultFrom())).get(appUserId) ?? [];
  const sick: string[] = [];
  const worked: string[] = [];
  for (const s of shifts) {
    if (s.typeName != null && isSickName(s.typeName)) sick.push(s.date);
    else if (s.typeName == null || !isAbsenceReasonName(s.typeName)) worked.push(s.date);
  }
  if (sick.length === 0) return [];
  const forms = (await loadFormCovers([appUserId])).get(appUserId) ?? [];
  return sickRuns(sick, worked).map(run => {
    const form = formCovering(run, forms);
    return {
      ...run,
      returned: worked.some(w => w > run.end),
      formId: form ? form.id : null,
      formStatus: form?.status ?? null,
    };
  });
}

export interface AttendanceEvent {
  date: string;
  kind: "late" | "absence";
  /** The Planday shift type name — "Arrived late", "Absent",
   *  "Dependants Leave", "Emergency Leave"… shown verbatim. */
  label: string;
}

/**
 * Non-sickness attendance events for ONE user over the window — lates and
 * absence-reason shifts (sickness excluded: it's covered by the spells).
 * Feeds the attendance timeline modal (Graeme, 2026-09-14: one
 * chronological view of an employee's sick leave, lates and absences).
 */
export async function attendanceEventsForUser(appUserId: number, fromIso?: string): Promise<AttendanceEvent[]> {
  const shifts = (await loadClassifiedShifts([appUserId], fromIso ?? defaultFrom(), { includeInactive: true })).get(appUserId) ?? [];
  const events: AttendanceEvent[] = [];
  for (const s of shifts) {
    const name = s.typeName;
    if (!name || isSickName(name)) continue;
    if (isLateName(name)) events.push({ date: s.date, kind: "late", label: name });
    else if (isAbsenceReasonName(name)) events.push({ date: s.date, kind: "absence", label: name });
  }
  return events.sort((a, b) => b.date.localeCompare(a.date));
}
