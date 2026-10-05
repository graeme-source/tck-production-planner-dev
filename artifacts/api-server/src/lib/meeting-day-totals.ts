/**
 * A production day's totals for the morning and end-of-day meetings' quality
 * tiles (wonkies, dog bins, "across N batches planned", shorts, leftover
 * filling). Main kitchen only, by the shared kitchen-scope rule: fried
 * chicken is made in a separate facility, and its bags had been added to the
 * day's "batches planned" (a 105-batch day read 274). Pure.
 */
import { isMainKitchen } from "@workspace/production-schedule";
import { sumQualityRejects } from "./quality-rejects";

export interface MeetingDayItem {
  recipeCategory: string | null;
  wonlyTotal: number | null;
  dogBinCount: number | null;
  batchesTarget: number | null;
  shortCount?: number | null;
  leftoverFillingGrams?: number | null;
}

export interface MeetingDayTotals {
  wonky: number;
  dogBin: number;
  /** Calzone batches + mac cheese packs planned (the long-standing meaning). */
  batchesTarget: number;
  shortCount: number;
  leftoverFillingGrams: number;
}

export function meetingDayTotals(items: readonly MeetingDayItem[]): MeetingDayTotals {
  const main = items.filter(it => isMainKitchen(it.recipeCategory));
  const rejects = sumQualityRejects(main);
  let batchesTarget = 0;
  let shortCount = 0;
  let leftoverFillingGrams = 0;
  for (const it of main) {
    batchesTarget += it.batchesTarget ?? 0;
    shortCount += it.shortCount ?? 0;
    leftoverFillingGrams += it.leftoverFillingGrams ?? 0;
  }
  return { wonky: rejects.wonky, dogBin: rejects.dogBin, batchesTarget, shortCount, leftoverFillingGrams };
}
