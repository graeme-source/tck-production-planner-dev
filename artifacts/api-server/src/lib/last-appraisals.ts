/**
 * What counts as a performance review on someone's record — the ONE SQL
 * definition, shared by the performance review report
 * (services/performance-review-data.ts: lastAppraisalDate,
 * lastAppraisalEntry) and the People list's Last review column
 * (routes/people-review-due.ts).
 *
 * An entry counts when it is classified Performance appraisal (its primary
 * classification or any ticked one, migration 0184) and isn't a cancelled
 * meeting. Its date is the meeting date, else the entry date — never when
 * it was typed. Share status doesn't matter. Callers use the entry alias `e`.
 *
 * Whether that makes someone overdue is lib/people-reviews review-due.ts.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { PERFORMANCE_APPRAISAL_LABEL } from "@workspace/people-reviews";
import { intArrayLiteral } from "./int-array-literal";

/** The date a review counts from (alias `e`). */
export const APPRAISAL_DATE_SQL: SQL = sql`COALESCE(e.meeting_date, e.entry_date)`;

/** Entry `e` is a performance appraisal, not cancelled. */
export const IS_APPRAISAL_SQL: SQL = sql`(
  (e.meeting_status IS NULL OR e.meeting_status <> 'cancelled')
  AND EXISTS (SELECT 1 FROM people_record_classifications c
               WHERE c.label = ${PERFORMANCE_APPRAISAL_LABEL}
                 AND (c.id = e.classification_id
                      OR c.id IN (SELECT ec.classification_id FROM people_record_entry_classifications ec WHERE ec.entry_id = e.id)))
)`;

/** Entry `e` counts as a review for the Last review column (Graeme, 26 Nov
 *  2026: Grant's held probation review didn't count): a performance
 *  appraisal as above, or ANY review meeting marked held, whatever it's
 *  classed as. Cancelled never counts. The performance review report keeps
 *  IS_APPRAISAL_SQL for its own "since the last appraisal" period. */
export const COUNTS_AS_REVIEW_SQL: SQL = sql`(${IS_APPRAISAL_SQL} OR e.meeting_status = 'held')`;

export interface LastAppraisal { entryId: number; date: string }

/** Everyone's last performance review on or before `onOrBefore`, in one
 *  query. People with none are simply missing from the map. */
export async function lastAppraisalsByUser(userIds: readonly number[], onOrBefore: string): Promise<Map<number, LastAppraisal>> {
  if (userIds.length === 0) return new Map();
  const r = await db.execute<{ user_id: number; id: number; d: string }>(sql`
    SELECT DISTINCT ON (e.user_id) e.user_id, e.id, ${APPRAISAL_DATE_SQL}::text AS d
      FROM people_record_entries e
     WHERE e.user_id = ANY(${intArrayLiteral([...userIds])}::int[])
       AND ${APPRAISAL_DATE_SQL} <= ${onOrBefore}::date
       AND ${COUNTS_AS_REVIEW_SQL}
     ORDER BY e.user_id, ${APPRAISAL_DATE_SQL} DESC, e.id DESC
  `);
  return new Map((r.rows ?? []).map(row => [Number(row.user_id), { entryId: Number(row.id), date: String(row.d).slice(0, 10) }]));
}
