/**
 * Who can open the Sales & Marketing area (marketing calendar, test boxes):
 * the founder, plus anyone whose "founder.sales" grant currently opens it
 * (the same answer the door gives, SOP gate included). Used by the calendar's
 * to-do people list and the test-box owner picker.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { FOUNDER_EMAIL, FOUNDER_FEATURES, isFounderEmail } from "@workspace/feature-registry";
import { allowedFeatureKeys } from "./feature-access";

/** Grant holders (founder excluded — the founder gets in by being the founder). */
export async function salesGrantPeople(excludeId: number | null = null): Promise<Array<{ id: number; name: string }>> {
  const rows = await db.execute<{ id: number; name: string; email: string | null }>(sql`
    SELECT u.id, u.name, u.email
    FROM feature_grants g
    JOIN app_users u ON u.id = g.user_id
    WHERE g.feature_key = ${FOUNDER_FEATURES.sales}
      AND u.is_active IS NOT FALSE
      AND u.id IS DISTINCT FROM ${excludeId}
    ORDER BY u.name
  `);
  const out: Array<{ id: number; name: string }> = [];
  for (const r of rows.rows) {
    if (isFounderEmail(r.email)) continue;
    if ((await allowedFeatureKeys(r.id)).includes(FOUNDER_FEATURES.sales)) out.push({ id: r.id, name: r.name });
  }
  return out;
}

/** Everyone who can open the area: the founder first, then grant holders. */
export async function salesAreaPeople(): Promise<Array<{ id: number; name: string }>> {
  const rows = await db.execute<{ id: number; name: string }>(sql`
    SELECT id, name FROM app_users WHERE is_active IS NOT FALSE AND email = ${FOUNDER_EMAIL} ORDER BY id
  `);
  const founders = rows.rows.map(r => ({ id: Number(r.id), name: r.name }));
  return [...founders, ...(await salesGrantPeople())];
}
