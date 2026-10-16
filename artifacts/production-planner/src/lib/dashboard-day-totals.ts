/**
 * The dashboard's day totals (Building / Mixing / Ovens / Wrapping tiles and
 * the upcoming-plans table). Calzone batches, mac cheese packs, and NOTHING
 * else: fried chicken has its own station and units, and counting it as
 * calzone batches showed "82 / 259" on a 105-batch day (Graeme, 2026-10-05).
 * Pure.
 */
import { kitchenLine, kpiKitchenLine, packsFromBatches } from "@workspace/production-schedule";

export { MAC_CHEESE_CATEGORY, FRIED_CHICKEN_CATEGORY } from "@workspace/production-schedule";

export type DayKind = "calzone" | "mac" | "other";

/** Which tile family an item belongs to — the shared main-kitchen rule
 *  (kitchenLine), with the separate facility reported as "other". */
export function dayKind(category: string | null | undefined): DayKind {
  const line = kitchenLine(category);
  return line === "separate" ? "other" : line;
}

export interface DayItem {
  recipeCategory?: string | null;
  /** Recipe route flags (migration 0202). A recipe out of the KPIs (buns)
   *  never counts as calzone batches, built or mixed; a skip-ovens recipe
   *  never counts at the ovens. Both still count in the wrapping packs. */
  excludeFromKpis?: boolean | null;
  skipOvens?: boolean | null;
  packSize?: number | string | null;
  freezerQty?: number | null;
  batchesTarget?: number | null;
  portionsPerBatch?: number | null;
  eightPackBagCount?: number | null;
  fridgeQty?: number | null;
  fridgeEightPackQty?: number | null;
  freezerEightPackQty?: number | null;
  stationCompletions?: Partial<Record<"building_1" | "building_2" | "ovens" | "mixing", number>> | null;
}

export interface DayTotals {
  calzoneBatches: number;
  macPacks: number;
  calzoneBuilt: number;
  calzoneMixed: number;
  ovensDone: number;
  packsTotal: number;
  packsWrapped: number;
}

export const EMPTY_DAY_TOTALS: DayTotals = { calzoneBatches: 0, macPacks: 0, calzoneBuilt: 0, calzoneMixed: 0, ovensDone: 0, packsTotal: 0, packsWrapped: 0 };

export function addDayItems(totals: DayTotals, items: readonly DayItem[]): DayTotals {
  const t = { ...totals };
  for (const it of items) {
    const kind = dayKind(it.recipeCategory);
    if (kind === "other") continue;
    const inKpis = kpiKitchenLine(it.recipeCategory, it.excludeFromKpis) !== "separate";
    const target = it.batchesTarget ?? 0;
    const sc = it.stationCompletions ?? {};
    const built = (sc.building_1 ?? 0) + (sc.building_2 ?? 0);
    // Ovens process calzones and mac (blast-chiller flow on the same station).
    if (inKpis && !it.skipOvens) t.ovensDone += Math.min(sc.ovens ?? 0, target);
    if (!inKpis) {
      // Out of the calzone counts; still wrapped below.
    } else if (kind === "mac") {
      t.macPacks += target;
    } else {
      t.calzoneBatches += target;
      // Cap per item so extra packs can't push the day past its total.
      t.calzoneBuilt += Math.min(built, target);
      t.calzoneMixed += Math.min(sc.mixing ?? 0, target);
    }
    if (target > 0) {
      // Planned pack units: 2-packs after the 8-pack bags take their 4
      // two-packs' worth of portions, plus the bags themselves. (Mac falls
      // out naturally: 2 portions/batch ÷ pack of 2.)
      // In the recipe's own pack size (÷2 until 16 Oct 2026 — a bun sheet
      // read 24 packs instead of 8). A bag is 8 portions = 8 / packSize packs.
      const bags = it.eightPackBagCount ?? 0;
      const bagPacks = Math.round((bags * 8) / (Number(it.packSize) || 2));
      const plannedTwoPacks = Math.max(0, packsFromBatches(target, it.portionsPerBatch, it.packSize) - bagPacks);
      const itemTotal = plannedTwoPacks + bags;
      const wrapped = (it.fridgeQty ?? 0) + (it.freezerQty ?? 0) + (it.fridgeEightPackQty ?? 0) + (it.freezerEightPackQty ?? 0);
      t.packsTotal += itemTotal;
      t.packsWrapped += Math.min(wrapped, itemTotal);
    }
  }
  return t;
}
