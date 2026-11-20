/**
 * Today's checklist plan for a station (rule: lib/checklist-day.ts). "today"
 * = the plan dated today, any status (closing checks often come after a plan
 * is marked complete). "next-prep"/"next-dough" = the first draft or active
 * plan whose prep/dough day is today or later — exactly what the dashboard's
 * Prep and Dough cards open (GET /production-plans/next-active).
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { londonDateString } from "../lib/london-time";
import { checklistPlanKind } from "../lib/checklist-day";

export async function todaysChecklistPlanId(stationType: string, today: string = londonDateString()): Promise<number | null> {
  const kind = checklistPlanKind(stationType);
  if (kind === "today") {
    const r = await db.execute<{ id: number }>(sql`
      SELECT id FROM production_plans WHERE plan_date = ${today} ORDER BY id LIMIT 1
    `);
    return r.rows[0]?.id ?? null;
  }
  const r = kind === "next-prep"
    ? await db.execute<{ id: number }>(sql`
        SELECT id FROM production_plans
        WHERE COALESCE(prep_date, plan_date) >= ${today} AND status IN ('draft', 'active')
        ORDER BY COALESCE(prep_date, plan_date) ASC, id ASC LIMIT 1
      `)
    : await db.execute<{ id: number }>(sql`
        SELECT id FROM production_plans
        WHERE COALESCE(dough_date, plan_date) >= ${today} AND status IN ('draft', 'active')
        ORDER BY COALESCE(dough_date, plan_date) ASC, id ASC LIMIT 1
      `);
  return r.rows[0]?.id ?? null;
}
