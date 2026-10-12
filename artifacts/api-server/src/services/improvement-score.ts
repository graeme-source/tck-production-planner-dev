/**
 * Improvement scores for the Leaner-board (Objective E). Reads the credit
 * pairs (improvement rows + credit rows, migration 0125), each
 * improvement's credit weight (0170) and the Planday attendance mirror,
 * then hands them to the pure rules in lib/improvement-score.ts.
 *
 * People are matched to Planday by app_users.planday_employee_id — the same
 * link the People records and the Hours vs contract report use. Someone not
 * linked has no score ("—"), never a made-up one.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { CREDIT_PAIRS } from "../lib/improvement-credits-data";
import { intArrayLiteral } from "../lib/int-array-literal";
import { londonDateString } from "../lib/london-time";
import { buildScores, scoreWindow, type CreditPair, type PersonScore, type RotaShift, type ScoreWindow } from "../lib/improvement-score";
import { backfillShiftStatuses, getAttendanceFromCache } from "./planday-attendance-cache";
import { getPlandayShiftTypes, isPlandayConfigured } from "./planday";

export interface ImprovementScores {
  window: ScoreWindow;
  byUser: Map<number, PersonScore>;
  /** False when Planday isn't set up or the mirror couldn't be read. */
  shiftsKnown: boolean;
}

export async function loadImprovementScores(userIds: number[]): Promise<ImprovementScores> {
  const window = scoreWindow(londonDateString());
  const ids = [...new Set(userIds.filter(n => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return { window, byUser: new Map(), shiftsKnown: false };

  const userRows = await db.execute<{ id: number; planday_employee_id: number | null }>(sql`
    SELECT id, planday_employee_id FROM app_users WHERE id = ANY(${intArrayLiteral(ids)}::int[])
  `);
  const users = (userRows.rows ?? []).map(r => ({
    userId: Number(r.id),
    plandayEmployeeId: r.planday_employee_id != null ? Number(r.planday_employee_id) : null,
  }));

  // Finished improvements, dated by when they were done. Fetched a day
  // either side of the window so the London-day cut below is exact whatever
  // timezone the server runs in.
  const pairRows = await db.execute<{ improvement_id: number; user_id: number; credit_weight: number; done: Date | string }>(sql`
    WITH pairs AS (${CREDIT_PAIRS})
    SELECT p.improvement_id, p.user_id, s.credit_weight,
           COALESCE(s.done_at, s.approved_at, s.created_at) AS done
      FROM pairs p
      JOIN improvement_submissions s ON s.id = p.improvement_id
     WHERE s.progress_status = 'complete'
       AND p.user_id = ANY(${intArrayLiteral(ids)}::int[])
       AND COALESCE(s.done_at, s.approved_at, s.created_at) >= ${window.from}::date - INTERVAL '1 day'
  `);
  const pairs: CreditPair[] = (pairRows.rows ?? []).map(r => ({
    improvementId: Number(r.improvement_id),
    userId: Number(r.user_id),
    weight: Number(r.credit_weight),
    doneDate: londonDateString(r.done instanceof Date ? r.done : new Date(r.done)),
  }));

  let shifts: RotaShift[] = [];
  let shiftsKnown = false;
  if (isPlandayConfigured()) {
    try {
      await backfillShiftStatuses(window.from, window.to);
      const [attendance, types] = await Promise.all([
        getAttendanceFromCache(window.from, window.to),
        getPlandayShiftTypes(),
      ]);
      const typeName = new Map(types.map(t => [t.id, t.name]));
      shifts = attendance.shifts.map(s => ({
        employeeId: s.employeeId,
        date: s.date,
        status: s.status ?? null,
        shiftTypeName: s.shiftTypeId != null ? typeName.get(s.shiftTypeId) ?? null : null,
      }));
      shiftsKnown = true;
    } catch (err) {
      console.warn("[improvement-score] shifts unavailable, scores shown as '—':", err);
    }
  }

  const scores = buildScores({ users, pairs, shifts, window, shiftsKnown });
  return { window, byUser: new Map(scores.map(s => [s.userId, s])), shiftsKnown };
}
