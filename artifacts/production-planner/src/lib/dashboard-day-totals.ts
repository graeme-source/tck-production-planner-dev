/**
 * The dashboard's day totals (Building / Mixing / Ovens / Wrapping tiles and
 * the upcoming-plans table). Calzone batches, mac cheese packs, and NOTHING
 * else: fried chicken has its own station and units, and counting it as
 * calzone batches showed "82 / 259" on a 105-batch day (Graeme, 2026-10-05).
 * Pure.
 */
import { kitchenLine } from "@workspace/production-schedule";

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
    const target = it.batchesTarget ?? 0;
    const sc = it.stationCompletions ?? {};
    const built = (sc.building_1 ?? 0) + (sc.building_2 ?? 0);
    // Ovens process calzones and mac (blast-chiller flow on the same station).
    t.ovensDone += Math.min(sc.ovens ?? 0, target);
    if (kind === "mac") {
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
      const bags = it.eightPackBagCount ?? 0;
      const plannedTwoPacks = Math.max(0, Math.floor((target * (it.portionsPerBatch ?? 10)) / 2) - bags * 4);
      const itemTotal = plannedTwoPacks + bags;
      const wrapped = (it.fridgeQty ?? 0) + (it.fridgeEightPackQty ?? 0) + (it.freezerEightPackQty ?? 0);
      t.packsTotal += itemTotal;
      t.packsWrapped += Math.min(wrapped, itemTotal);
    }
  }
  return t;
}
