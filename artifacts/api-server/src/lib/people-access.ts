/**
 * Who has People access — the ONE place the server asks (Graeme, 2026-09-25).
 *
 * People access (employee records, reviews, return-to-work forms) is a row
 * in people_access_grants (migration 0126), switched on and off by the
 * founder in Settings → Team & Access. It replaced a hard-coded email list
 * (PEOPLE_DATA_EMAILS); every former use of that list goes through here.
 * Roles never grant it, and an inactive account never has it.
 *
 * No cache, deliberately: it's one indexed lookup, the People pages are
 * low-traffic, and revoking access must bite on the very next request —
 * a cache would leave a window where someone just removed can still read.
 *
 * The rules (who may grant, what the gate does) are pure and tested:
 * people-access-rules.ts and people-unlock.ts.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface PeopleGateFacts {
  hasAccess: boolean;
  hasPrivatePin: boolean;
}

/** Access + whether their private People PIN is set, in one lookup. An
 *  unknown user has neither. Throws on a DB failure — callers fail closed. */
export async function peopleGateFacts(userId: number | null | undefined): Promise<PeopleGateFacts> {
  if (!userId) return { hasAccess: false, hasPrivatePin: false };
  const rows = await db.execute<{ is_active: boolean; has_private_pin: boolean; granted: boolean }>(sql`
    SELECT u.is_active,
           (u.private_pin_hash IS NOT NULL) AS has_private_pin,
           (g.user_id IS NOT NULL) AS granted
      FROM app_users u
      LEFT JOIN people_access_grants g ON g.user_id = u.id
     WHERE u.id = ${userId}
     LIMIT 1
  `);
  const r = rows.rows[0];
  if (!r) return { hasAccess: false, hasPrivatePin: false };
  return { hasAccess: r.granted === true && r.is_active === true, hasPrivatePin: r.has_private_pin === true };
}

/** Does this user have People access? Throws on a DB failure. */
export async function hasPeopleAccess(userId: number | null | undefined): Promise<boolean> {
  return (await peopleGateFacts(userId)).hasAccess;
}

/** Same, but a DB failure answers "no" (logged) instead of throwing — for
 *  places like /auth/me that must never fail the whole app over this. */
export async function hasPeopleAccessOrFalse(userId: number | null | undefined, where: string): Promise<boolean> {
  try {
    return await hasPeopleAccess(userId);
  } catch (err) {
    console.error(`[people-access] lookup failed in ${where} — treating as no access:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Everyone active with People access — e.g. who gets the RTW chase to-dos. */
export async function peopleAccessUserIds(): Promise<number[]> {
  const rows = await db.execute<{ id: number }>(sql`
    SELECT u.id FROM app_users u
      JOIN people_access_grants g ON g.user_id = u.id
     WHERE u.is_active = TRUE
     ORDER BY u.id
  `);
  return rows.rows.map(r => Number(r.id));
}
