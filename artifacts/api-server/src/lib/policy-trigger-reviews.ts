/**
 * The reviews that can answer an attendance policy trigger, per person
 * (Graeme, 2026-10-12). Since migration 0178 every review lives in the
 * employment record (people_record_entries). An entry answers a trigger if
 * it's explicitly linked to it (answers_trigger, migration 0183) or, with
 * no link, if ANY of its classifications (0184) shows attendance evidence. Which rows
 * count, and what they mean, is decided by the pure entryReviewFact in
 * @workspace/people-reviews (policy-trigger.ts) — this only loads them.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { entryReviewFact, type PolicyReviewFact } from "@workspace/people-reviews";
import { entryClassIdsSql } from "./entry-classifications";

export async function loadPolicyReviews(userIds: readonly number[], todayIso: string): Promise<Map<number, PolicyReviewFact[]>> {
  const out = new Map<number, PolicyReviewFact[]>();
  if (userIds.length === 0) return out;
  const ids = sql.join(userIds.map(id => sql`${id}`), sql`, `);
  // Evidence of EVERY classification ticked on the entry (0184).
  const classes = entryClassIdsSql("e");
  const entries = await db.execute<{
    id: number; user_id: number; meeting_status: string | null; evidence: Array<string | null>; meeting_date: string | null; entry_date: string;
    answers_trigger: string | null;
  }>(sql`
    SELECT e.id, e.user_id, e.meeting_status, e.meeting_date::text, e.entry_date::text, e.answers_trigger,
           ARRAY(SELECT c.evidence FROM people_record_classifications c WHERE c.id IN ${classes}) AS evidence
      FROM people_record_entries e
     WHERE e.user_id IN (${ids})
       AND (e.answers_trigger IS NOT NULL
            OR EXISTS (SELECT 1 FROM people_record_classifications c WHERE c.id IN ${classes} AND c.evidence IS NOT NULL))
  `);
  for (const e of entries.rows) {
    const f = entryReviewFact({
      id: Number(e.id), meetingStatus: e.meeting_status, evidence: e.evidence, meetingDate: e.meeting_date, entryDate: e.entry_date,
      answersTrigger: e.answers_trigger,
    }, todayIso);
    if (!f) continue;
    const userId = Number(e.user_id);
    out.set(userId, [...(out.get(userId) ?? []), f]);
  }
  return out;
}
