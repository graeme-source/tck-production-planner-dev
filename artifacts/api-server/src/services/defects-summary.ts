/**
 * Loads everything the Defects KPI needs for a range of London days and
 * hands it to the pure summariseDefects (lib/defects-kpi.ts). Shared by
 * /api/defects/summary and the two meetings, so they can never disagree.
 *
 *   - packs made: planItems (the Team efficiency loader) → madeByLine →
 *     totalPacksMade, per plan date
 *   - wonkies + dog bins: production_plan_items counters → sumQualityRejects,
 *     per plan date (the same call the morning and end-of-day meetings make)
 *   - where rejects happened: quality_reject_events net taps per station
 *   - recorded defects + their types: the defects tables (migration 0139)
 *
 * Main kitchen only (kitchen-scope rule): fried chicken is made in a separate
 * facility, so its packs, rejects and reject taps never count here.
 */
import { db, defectsTable, defectTypesTable } from "@workspace/db";
import { and, gte, isNull, lte, sql } from "drizzle-orm";
import { isMainKitchen } from "@workspace/production-schedule";
import { sumQualityRejects } from "../lib/quality-rejects";
import { madeByLine, totalPacksMade } from "../lib/team-efficiency-day";
import { summariseDefects, type DefectDayInput, type DefectSummary, type RejectStationInput } from "../lib/defects-kpi";
import { planItems } from "./team-efficiency-job";

export async function loadDefectSummary(from: string, to: string): Promise<DefectSummary> {
  const [made, rejectItems, rejectEvents, recorded, types] = await Promise.all([
    planItems(from, to),
    db.execute<{ date: string; category: string | null; wonly_total: number | null; dog_bin_count: number | null }>(sql`
      SELECT p.plan_date::text AS date, r.category, i.wonly_total, i.dog_bin_count
      FROM production_plans p JOIN production_plan_items i ON i.plan_id = p.id
      LEFT JOIN recipes r ON r.id = i.recipe_id
      WHERE p.plan_date BETWEEN ${from} AND ${to}
    `),
    db.execute<{ kind: "wonky" | "dog_bin"; station_type: string | null; category: string | null; packs: number }>(sql`
      SELECT e.kind, e.station_type, r.category, SUM(e.delta)::int AS packs
      FROM quality_reject_events e JOIN production_plans p ON p.id = e.plan_id
      LEFT JOIN production_plan_items i ON i.id = e.plan_item_id
      LEFT JOIN recipes r ON r.id = i.recipe_id
      WHERE p.plan_date BETWEEN ${from} AND ${to}
      GROUP BY e.kind, e.station_type, r.category
    `),
    db.select({
      occurredOn: defectsTable.occurredOn, typeId: defectsTable.defectTypeId, packs: defectsTable.packs, station: defectsTable.station,
    }).from(defectsTable).where(and(isNull(defectsTable.deletedAt), gte(defectsTable.occurredOn, from), lte(defectsTable.occurredOn, to))),
    db.select({
      id: defectTypesTable.id, name: defectTypesTable.name, active: defectTypesTable.active, sortOrder: defectTypesTable.sortOrder,
    }).from(defectTypesTable),
  ]);

  const rejectsByDate = new Map<string, Array<{ wonlyTotal: number | null; dogBinCount: number | null }>>();
  for (const r of rejectItems.rows) {
    if (!isMainKitchen(r.category)) continue;
    const list = rejectsByDate.get(r.date) ?? [];
    list.push({
      wonlyTotal: r.wonly_total == null ? null : Number(r.wonly_total),
      dogBinCount: r.dog_bin_count == null ? null : Number(r.dog_bin_count),
    });
    rejectsByDate.set(r.date, list);
  }
  const dates = new Set<string>([...made.keys(), ...rejectsByDate.keys()]);
  const days: DefectDayInput[] = [...dates].map(date => {
    const q = sumQualityRejects(rejectsByDate.get(date) ?? []);
    return { date, packsMade: totalPacksMade(madeByLine(made.get(date) ?? [])), wonky: q.wonky, dogBin: q.dogBin };
  });
  const rejectStations: RejectStationInput[] = rejectEvents.rows.filter(r => isMainKitchen(r.category)).map(r => ({
    kind: r.kind, station: r.station_type, packs: Number(r.packs) || 0,
  }));

  return summariseDefects({ from, to, days, recorded, types, rejectStations });
}
