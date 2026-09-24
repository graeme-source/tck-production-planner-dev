/**
 * The database half of multi-person improvement credit (migration 0125;
 * Objectives E and H). The rules — who counts, in what order, how names
 * read — are pure and tested in lib/db/src/improvement-credits.ts; this file
 * only reads and writes them.
 *
 * The one invariant every writer keeps: improvement_submissions.credited_to
 * is the FIRST person in the list, and every person in the list has an
 * improvement_credits row. Readers still union the two (see CREDIT_PAIRS),
 * so a writer that only sets credited_to can never lose anyone credit.
 */
import { db, usersTable, improvementSubmissionsTable, mergeCredits, normaliseCreditIds, type CreditPerson } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { intArrayLiteral } from "./int-array-literal";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

/**
 * Every (improvement, person) credit pair: the credit rows PLUS the lead
 * credited_to. UNION de-duplicates, so the lead is counted once whether or
 * not it also has a row. Use as a CTE: `WITH pairs AS (${CREDIT_PAIRS}) …`.
 */
export const CREDIT_PAIRS = sql`
  SELECT c.improvement_id, c.user_id FROM improvement_credits c
  UNION
  SELECT s.id AS improvement_id, s.credited_to AS user_id
    FROM improvement_submissions s
   WHERE s.credited_to IS NOT NULL
`;

/** Everyone credited on each of these improvements, lead first. One query. */
export async function creditsFor(
  rows: ReadonlyArray<{ id: number; creditedTo: number | null; creditedToName: string | null }>,
  exec: Db = db,
): Promise<Map<number, CreditPerson[]>> {
  const out = new Map<number, CreditPerson[]>();
  if (rows.length === 0) return out;
  const result = await exec.execute<{ improvement_id: number; user_id: number; name: string | null }>(sql`
    SELECT c.improvement_id, c.user_id, COALESCE(u.name, c.user_name) AS name
      FROM improvement_credits c
      LEFT JOIN app_users u ON u.id = c.user_id
     WHERE c.improvement_id = ANY(${intArrayLiteral(rows.map(r => r.id))}::int[])
     ORDER BY c.improvement_id, c.position, c.id
  `);
  const byId = new Map<number, CreditPerson[]>();
  for (const r of result.rows ?? []) {
    const list = byId.get(Number(r.improvement_id)) ?? [];
    list.push({ userId: Number(r.user_id), name: r.name });
    byId.set(Number(r.improvement_id), list);
  }
  for (const row of rows) {
    out.set(row.id, mergeCredits({ userId: row.creditedTo, name: row.creditedToName }, byId.get(row.id) ?? []));
  }
  return out;
}

export type SetCreditsResult =
  | { ok: true; credits: CreditPerson[] }
  | { ok: false; status: number; error: string };

/**
 * Replace an improvement's credit list with exactly these people, in this
 * order (the first is the lead). Refuses an empty list — nobody ends up
 * with no one credited by an edit — and anyone not on the team list.
 * Call inside a transaction: rows and the lead column change together.
 */
export async function setImprovementCredits(exec: Db, improvementId: number, userIds: ReadonlyArray<unknown>): Promise<SetCreditsResult> {
  const ids = normaliseCreditIds(userIds);
  if (ids.length === 0) return { ok: false, status: 400, error: "Pick at least one person to credit." };

  const people = await exec.select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable).where(inArray(usersTable.id, ids));
  const nameById = new Map(people.map(p => [p.id, p.name]));
  if (ids.some(id => !nameById.has(id))) {
    return { ok: false, status: 400, error: "Someone in that list isn't on the team list." };
  }

  const [lead] = await exec.update(improvementSubmissionsTable)
    .set({ creditedTo: ids[0]!, creditedToName: nameById.get(ids[0]!) ?? null, updatedAt: new Date() })
    .where(eq(improvementSubmissionsTable.id, improvementId))
    .returning({ id: improvementSubmissionsTable.id });
  if (!lead) return { ok: false, status: 404, error: "Not found" };

  await exec.execute(sql`
    DELETE FROM improvement_credits
     WHERE improvement_id = ${improvementId}
       AND NOT (user_id = ANY(${intArrayLiteral(ids)}::int[]))
  `);
  for (const [position, userId] of ids.entries()) {
    await exec.execute(sql`
      INSERT INTO improvement_credits (improvement_id, user_id, user_name, position)
      VALUES (${improvementId}, ${userId}, ${nameById.get(userId) ?? null}, ${position})
      ON CONFLICT (improvement_id, user_id)
      DO UPDATE SET position = EXCLUDED.position, user_name = EXCLUDED.user_name
    `);
  }
  return { ok: true, credits: ids.map(userId => ({ userId, name: nameById.get(userId) ?? null })) };
}

/**
 * Make sure the current lead (credited_to) has its row. For writers that set
 * credited_to directly — completing an improvement, the Fix queue — so the
 * table stays complete. Idempotent; keeps an existing row's position.
 */
export async function pinLeadCredit(exec: Db, improvementId: number): Promise<void> {
  await exec.execute(sql`
    INSERT INTO improvement_credits (improvement_id, user_id, user_name, position)
    SELECT s.id, s.credited_to, s.credited_to_name, 0
      FROM improvement_submissions s
     WHERE s.id = ${improvementId} AND s.credited_to IS NOT NULL
    ON CONFLICT (improvement_id, user_id) DO NOTHING
  `);
}
