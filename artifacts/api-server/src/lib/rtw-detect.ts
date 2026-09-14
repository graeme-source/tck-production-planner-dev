/**
 * Detects spells of sick leave from the Planday mirror and decides who owes
 * a return-to-work form (Graeme, 2026-09-14): a spell is DUE once the
 * person is back — a worked shift after the spell's last sick day — and no
 * form covers those dates yet. Reads the local mirror only (fast, no
 * Planday calls); the mirror's hourly trailing sync keeps it current.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getPlandayShiftTypes } from "../services/planday";
import { isSickName, isAbsenceReasonName, sickRuns } from "../services/attendance-classify";

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

const WINDOW_DAYS = 120;

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Sick spells for ONE app user (empty when they have no Planday link).
 *  `fromIso` widens the default trailing window — the report's sick-leave
 *  modal passes its own date range so the instances shown match the
 *  numbers clicked (Graeme, 2026-09-14: 9 instances in the table, 3 in
 *  the modal, because the modal only looked back 120 days). */
export async function sickSpellsForUser(appUserId: number, fromIso?: string): Promise<SickSpell[]> {
  const map = await sickSpellsForUsers([appUserId], fromIso);
  return map.get(appUserId) ?? [];
}

/** Sick spells per app user over the trailing window, forms matched. */
export async function sickSpellsForUsers(appUserIds: number[] | null, fromIso?: string): Promise<Map<number, SickSpell[]>> {
  const from = fromIso ?? daysAgoIso(WINDOW_DAYS);

  const users = await db.execute<{ id: number; planday_employee_id: number | null }>(sql`
    SELECT id, planday_employee_id FROM app_users
    WHERE is_active = TRUE AND planday_employee_id IS NOT NULL
    ${appUserIds ? sql`AND id IN (${sql.join(appUserIds.map(i => sql`${i}`), sql`, `)})` : sql``}
  `);
  const byPlanday = new Map<number, number>();
  for (const u of users.rows) {
    if (u.planday_employee_id != null) byPlanday.set(Number(u.planday_employee_id), Number(u.id));
  }
  const out = new Map<number, SickSpell[]>();
  if (byPlanday.size === 0) return out;

  const shiftTypes = await getPlandayShiftTypes();
  const typeName = new Map(shiftTypes.map(t => [t.id, t.name]));

  const shifts = await db.execute<{ employee_id: number; shift_type_id: number | null; date: string }>(sql`
    SELECT employee_id, shift_type_id, date::text FROM planday_shifts_cache
    WHERE date >= ${from} AND employee_id IN (${sql.join([...byPlanday.keys()].map(i => sql`${i}`), sql`, `)})
  `);

  const sickByUser = new Map<number, string[]>();
  const workedByUser = new Map<number, string[]>();
  for (const s of shifts.rows) {
    const appId = byPlanday.get(Number(s.employee_id));
    if (appId == null) continue;
    const name = s.shift_type_id != null ? typeName.get(Number(s.shift_type_id)) : undefined;
    const date = s.date.slice(0, 10);
    if (name && isSickName(name)) {
      (sickByUser.get(appId) ?? sickByUser.set(appId, []).get(appId)!).push(date);
    } else if (!name || !isAbsenceReasonName(name)) {
      (workedByUser.get(appId) ?? workedByUser.set(appId, []).get(appId)!).push(date);
    }
  }

  const withSick = [...sickByUser.keys()];
  if (withSick.length === 0) return out;

  const forms = await db.execute<{ id: number; user_id: number; absence_start: string; absence_end: string | null; status: string }>(sql`
    SELECT id, user_id, absence_start::text, absence_end::text, status FROM return_to_work_forms
    WHERE user_id IN (${sql.join(withSick.map(i => sql`${i}`), sql`, `)})
  `);

  for (const appId of withSick) {
    const worked = workedByUser.get(appId) ?? [];
    const runs = sickRuns(sickByUser.get(appId) ?? [], worked);
    const userForms = forms.rows.filter(f => Number(f.user_id) === appId);
    out.set(appId, runs.map(run => {
      const form = userForms.find(f =>
        f.absence_start <= run.end && (f.absence_end ?? f.absence_start) >= run.start);
      return {
        ...run,
        returned: worked.some(w => w > run.end),
        formId: form ? Number(form.id) : null,
        formStatus: form?.status ?? null,
      };
    }));
  }
  return out;
}

/** Spells that owe a form: the person is back and nothing covers the dates. */
export function dueSpells(spells: SickSpell[]): SickSpell[] {
  return spells.filter(s => s.returned && s.formId == null);
}
