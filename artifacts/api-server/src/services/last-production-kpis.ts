/**
 * Loads the morning meeting's "Last Production" numbers (Graeme, 2026-10-22):
 * the last production day's KPIs plus each KPI over the last 7 PRODUCTION
 * days (not calendar days), for the trend sparklines.
 *
 * One source of truth: every day — including the headline day, which is just
 * the last entry — goes through the same helpers the slide always used
 * (lib/yesterday-kpis, meetingDayTotals, loadDefectSummary). Each KPI family
 * is ONE query over the whole range, except packing, which is one Shopify tag
 * read per dispatch day (memoised for finished days).
 */
import {
  db,
  batchCompletionsTable,
  productionPlansTable,
  productionPlanItemsTable,
  recipesTable,
} from "@workspace/db";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import {
  computeBuilderBatchesPerHourForDays,
  computePackingOrdersPerHourForPastDays,
  countImprovementsCompletedForDays,
} from "../lib/yesterday-kpis";
import { meetingDayTotals, type MeetingDayItem } from "../lib/meeting-day-totals";
import { loadDefectSummary } from "./defects-summary";
import {
  productionDates,
  lastProductionDays,
  kpiSeries,
  type KpiSeries,
  type ProductionDayKpis,
  addCalendarDays,
} from "../lib/last-production-day";

/** How far back to look for production days — comfortably more than any
 *  shutdown (Christmas) so 7 production days are always found. */
const LOOKBACK_DAYS = 60;

export interface LastProductionKpis {
  /** Oldest first; the last entry is the last production day. Empty = no history. */
  days: string[];
  lastProductionDay: string | null;
  byDay: Map<string, ProductionDayKpis>;
  series: KpiSeries;
}

/** Plan dates with real same-day production in the main kitchen, before today. */
export async function loadProductionDates(today: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({
      date: productionPlansTable.planDate,
      stationType: batchCompletionsTable.stationType,
      recipeCategory: recipesTable.category,
      excludeFromKpis: recipesTable.excludeFromKpis,
    })
    .from(batchCompletionsTable)
    .innerJoin(productionPlanItemsTable, eq(batchCompletionsTable.planItemId, productionPlanItemsTable.id))
    .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(and(
      lt(productionPlansTable.planDate, today),
      gte(productionPlansTable.planDate, addCalendarDays(today, -LOOKBACK_DAYS)),
    ));
  return productionDates(rows.map(r => ({ ...r, date: String(r.date) })));
}

export async function loadLastProductionKpis(today: string, count = 7): Promise<LastProductionKpis> {
  const days = lastProductionDays(today, await loadProductionDates(today), count);
  const lastProductionDay = days[days.length - 1] ?? null;
  const byDay = new Map<string, ProductionDayKpis>();
  if (!lastProductionDay) return { days, lastProductionDay, byDay, series: kpiSeries(days, byDay) };

  const [items, builder, packing, improvements, defects] = await Promise.all([
    db
      .select({
        planDate: productionPlansTable.planDate,
        wonlyTotal: productionPlanItemsTable.wonlyTotal,
        dogBinCount: productionPlanItemsTable.dogBinCount,
        shortCount: productionPlanItemsTable.shortCount,
        leftoverFillingGrams: productionPlanItemsTable.leftoverFillingGrams,
        batchesTarget: productionPlanItemsTable.batchesTarget,
        recipeCategory: recipesTable.category,
        excludeFromKpis: recipesTable.excludeFromKpis,
      })
      .from(productionPlanItemsTable)
      .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
      .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
      .where(inArray(productionPlansTable.planDate, days)),
    computeBuilderBatchesPerHourForDays(days).catch(err => {
      console.warn("[last-production] builder run rate failed:", err);
      return null;
    }),
    computePackingOrdersPerHourForPastDays(days, today),
    countImprovementsCompletedForDays(days).catch(err => {
      console.warn("[last-production] improvements completed failed:", err);
      return null;
    }),
    // Same loader as the Defects page; its byDay rows are the per-day figures.
    loadDefectSummary(days[0]!, lastProductionDay).catch(err => {
      console.warn("[last-production] defects failed:", err);
      return null;
    }),
  ]);

  const itemsByDay = new Map<string, MeetingDayItem[]>();
  for (const it of items) {
    const d = String(it.planDate);
    const list = itemsByDay.get(d);
    if (list) list.push(it); else itemsByDay.set(d, [it]);
  }
  const defectsByDay = new Map((defects?.byDay ?? []).map(r => [r.date, r]));

  for (const date of days) {
    const totals = meetingDayTotals(itemsByDay.get(date) ?? []);
    const def = defectsByDay.get(date);
    byDay.set(date, {
      builderBatchesPerHour: builder?.get(date)?.batchesPerHour ?? null,
      packingBatchesPerHour: packing.get(date)?.ordersPerHour ?? null,
      wonkyCount: totals.wonky,
      dogBinCount: totals.dogBin,
      shortCount: totals.shortCount,
      leftoverFillingGrams: totals.leftoverFillingGrams,
      batchesTarget: totals.batchesTarget,
      // 0 is a real zero; null only when the lookup failed.
      improvementsCompleted: improvements ? (improvements.get(date) ?? 0) : null,
      defects: defects ? (def ? { count: def.defects, pct: def.pct, packsMade: def.packsMade } : { count: 0, pct: null, packsMade: 0 }) : null,
    });
  }
  return { days, lastProductionDay, byDay, series: kpiSeries(days, byDay) };
}
