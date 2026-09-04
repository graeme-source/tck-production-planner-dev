import { db, usersTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { FOUNDER_EMAILS } from "../routes/lean-reviews";

/**
 * Put a quiet "check this improvement" task on the founders' to-do lists.
 *
 * Idempotent: an open review task for the same improvement is never
 * duplicated, so it's safe to call again on a re-submission or a backfill.
 *
 * Lives here rather than in routes/improvements.ts because the one-time
 * backfill needs it too, and a startup job importing a route file is how
 * import cycles start.
 */
export async function queueReviewTodo(improvementId: number, title: string): Promise<void> {
  const founders = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.email, [...FOUNDER_EMAILS]));
  for (const f of founders) {
    await db.execute(sql`
      INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, status, improvement_id)
      SELECT ${f.id}, NULL, 'Improvement review', ${"Review improvement: " + title},
             'Open it, check the before and after, and approve it — or send it back with a note.',
             '/improvements', 'normal', 'open', ${improvementId}
      WHERE NOT EXISTS (
        SELECT 1 FROM todo_tasks
        WHERE assignee_id = ${f.id} AND improvement_id = ${improvementId}
          AND created_by_name = 'Improvement review' AND status = 'open'
      )
    `);
  }
}
