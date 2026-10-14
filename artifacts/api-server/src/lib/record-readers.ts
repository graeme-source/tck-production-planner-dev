/**
 * Who can open someone's employment record — the founder and everyone with
 * People access, never on their own record (canWriteEmploymentRecord, the
 * same rule the People routes use). Objective H.
 *
 * Used for "Shared with HR" (Graeme, 2026-10-14): the only people a private
 * note can be shared with, and the "who else can read it" line when a note
 * is shared with the colleague. Read fresh every time — revoking People
 * access must bite on the very next request.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { canWriteEmploymentRecord, type RecordActor } from "./people-write-access";
import { isFounderEmail } from "./founder-email";
import { loadRecordSubject } from "../middleware/employment-record-write";

export interface RecordReader { id: number; name: string }

export async function recordReaders(subjectUserId: number): Promise<RecordReader[]> {
  const subject = await loadRecordSubject(subjectUserId);
  if (!subject) return [];
  const rows = await db.execute<{ id: number; name: string; email: string | null; planday_employee_id: number | null; granted: boolean }>(sql`
    SELECT u.id, u.name, u.email, u.planday_employee_id, (g.user_id IS NOT NULL) AS granted
      FROM app_users u
      LEFT JOIN people_access_grants g ON g.user_id = u.id
     WHERE u.is_active = TRUE
     ORDER BY u.name
  `);
  return rows.rows
    .map(r => ({
      actor: {
        id: Number(r.id), email: r.email, hasPeopleAccess: r.granted === true,
        plandayEmployeeId: r.planday_employee_id == null ? null : Number(r.planday_employee_id),
      } satisfies RecordActor,
      name: r.name,
    }))
    .filter(({ actor }) => (actor.hasPeopleAccess || isFounderEmail(actor.email)) && canWriteEmploymentRecord(actor, subject))
    .map(({ actor, name }) => ({ id: actor.id, name }));
}

/** Names for ids (any account) — for "Shared with …" labels. */
export async function namesById(ids: readonly number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db.execute<{ id: number; name: string }>(sql`
    SELECT id, name FROM app_users WHERE id IN (${sql.join(unique.map(id => sql`${id}`), sql`, `)})
  `);
  return new Map(rows.rows.map(r => [Number(r.id), r.name]));
}
