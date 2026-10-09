/**
 * Each day's waste deduction for Team efficiency (Graeme, 2026-10-09;
 * Objective E): the recorded lost value of the waste that happened that
 * London day (defects.lost_value, migration 0152). Old defect records have
 * no lost value and take nothing off. The sum rule is pure and tested
 * (wasteByDay in lib/waste-cost.ts).
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { wasteByDay } from "../lib/waste-cost";

export async function loadWasteByDay(from: string, to: string): Promise<Map<string, number>> {
  const r = await db.execute<{ occurred_on: string; lost_value: string | null }>(sql`
    SELECT occurred_on::text AS occurred_on, lost_value FROM defects
    WHERE deleted_at IS NULL AND lost_value IS NOT NULL AND occurred_on BETWEEN ${from} AND ${to}
  `);
  return wasteByDay(r.rows.map(x => ({ occurredOn: x.occurred_on, lostValue: x.lost_value == null ? null : Number(x.lost_value) })));
}
