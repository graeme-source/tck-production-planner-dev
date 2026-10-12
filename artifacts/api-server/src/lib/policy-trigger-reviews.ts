/**
 * The reviews that can answer an attendance policy trigger, per person,
 * from both places they're recorded (Graeme, 2026-10-12): the meetings
 * diary (employee_meetings) and the employment record
 * (people_record_entries whose classification shows attendance evidence).
 * Which rows count, and what they mean, is decided by the pure helpers in
 * @workspace/people-reviews (policy-trigger.ts) — this only loads them.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  entryReviewFact, meetingReviewFact, POLICY_REVIEW_MEETING_KINDS, type PolicyReviewFact,
} from "@workspace/people-reviews";

export async function loadPolicyReviews(userIds: readonly number[], todayIso: string): Promise<Map<number, PolicyReviewFact[]>> {
  const out = new Map<number, PolicyReviewFact[]>();
  if (userIds.length === 0) return out;
  const ids = sql.join(userIds.map(id => sql`${id}`), sql`, `);
  const kinds = sql.join(POLICY_REVIEW_MEETING_KINDS.map(k => sql`${k}`), sql`, `);
  const [meetings, entries] = await Promise.all([
    db.execute<{ id: number; subject_user_id: number; kind: string; status: string; scheduled_for: string | null; held_at: string | null; created_at: string | null }>(sql`
      SELECT id, subject_user_id, kind, status, scheduled_for::text, held_at::text, created_at::text
        FROM employee_meetings
       WHERE subject_user_id IN (${ids}) AND status <> 'cancelled' AND kind IN (${kinds})
    `),
    db.execute<{ id: number; user_id: number; evidence: string | null; meeting_date: string | null; entry_date: string }>(sql`
      SELECT e.id, e.user_id, c.evidence, e.meeting_date::text, e.entry_date::text
        FROM people_record_entries e
        JOIN people_record_classifications c ON c.id = e.classification_id
       WHERE e.user_id IN (${ids}) AND c.evidence IS NOT NULL
    `),
  ]);
  const add = (userId: number, f: PolicyReviewFact | null) => {
    if (!f) return;
    const list = out.get(userId) ?? [];
    list.push(f);
    out.set(userId, list);
  };
  for (const m of meetings.rows) {
    add(Number(m.subject_user_id), meetingReviewFact({
      id: Number(m.id), kind: m.kind, status: m.status, scheduledFor: m.scheduled_for, heldAt: m.held_at, createdAt: m.created_at,
    }));
  }
  for (const e of entries.rows) {
    add(Number(e.user_id), entryReviewFact({ id: Number(e.id), evidence: e.evidence, meetingDate: e.meeting_date, entryDate: e.entry_date }, todayIso));
  }
  return out;
}
