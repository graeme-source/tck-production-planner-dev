/**
 * The reviews that can answer an attendance policy trigger, per person
 * (Graeme, 2026-10-12). Since migration 0178 every review lives in the
 * employment record (people_record_entries): any review that isn't
 * cancelled counts, whatever its classification, and so does an entry with
 * no meeting whose classification shows attendance evidence. Which rows
 * count, and what they mean, is decided by the pure entryReviewFact in
 * @workspace/people-reviews (policy-trigger.ts) — this only loads them.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { entryReviewFact, type PolicyReviewFact } from "@workspace/people-reviews";

export async function loadPolicyReviews(userIds: readonly number[], todayIso: string): Promise<Map<number, PolicyReviewFact[]>> {
  const out = new Map<number, PolicyReviewFact[]>();
  if (userIds.length === 0) return out;
  const ids = sql.join(userIds.map(id => sql`${id}`), sql`, `);
  const entries = await db.execute<{ id: number; user_id: number; meeting_status: string | null; evidence: string | null; meeting_date: string | null; entry_date: string }>(sql`
    SELECT e.id, e.user_id, e.meeting_status, c.evidence, e.meeting_date::text, e.entry_date::text
      FROM people_record_entries e
      JOIN people_record_classifications c ON c.id = e.classification_id
     WHERE e.user_id IN (${ids})
       AND (e.meeting_status IS NOT NULL OR c.evidence IS NOT NULL)
  `);
  for (const e of entries.rows) {
    const f = entryReviewFact({
      id: Number(e.id), meetingStatus: e.meeting_status, evidence: e.evidence, meetingDate: e.meeting_date, entryDate: e.entry_date,
    }, todayIso);
    if (!f) continue;
    const userId = Number(e.user_id);
    out.set(userId, [...(out.get(userId) ?? []), f]);
  }
  return out;
}
