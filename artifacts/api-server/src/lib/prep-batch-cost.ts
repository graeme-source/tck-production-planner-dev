/**
 * Prep minutes and profit per recipe batch (Graeme, 27 Oct 2026 — product
 * decisions on "profit per batch AFTER prep labour": premium recipes vs
 * simpler, cheaper ones; Objectives C and I). Pure.
 *
 *   prep minutes / batch  = Σ over the recipe's prep items of
 *                           amount per batch (lib/prep-usage.ts) ×
 *                           that item's measured rate (lib/prep-timing.ts)
 *   gross £ / batch       = (list price − cost per pack incl. packaging)
 *                           × packs per batch — the recipe page's own
 *                           figures (routes/recipes.ts computeCosts)
 *   prep labour £ / batch = prep minutes ÷ 60 × the £/hour setting
 *   profit after prep     = gross − prep labour
 * Items with no timings yet add nothing and are listed, so a recipe's
 * minutes are "what we've measured so far", never a guess.
 */
import type { PrepUsage } from "./prep-usage";
import type { Confidence, ItemTiming } from "./prep-timing";

/** £ per hour of prep labour, loaded (Graeme's starting figure). */
export const DEFAULT_PREP_LABOUR_RATE = 14;
export const MAX_PREP_LABOUR_RATE = 200;
/** app_settings key for the rate (Analytics → Prep times, autosaved). */
export const PREP_LABOUR_RATE_KEY = "prep_labour_rate_per_hour";

/** The stored setting as a rate; anything unusable falls back to the default. */
export function parseLabourRate(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= MAX_PREP_LABOUR_RATE ? n : DEFAULT_PREP_LABOUR_RATE;
}

export type LineStatus = "timed" | "not_measured" | "no_matching_amount";

export interface RecipePrepLine {
  itemKey: string;
  minutes: number | null;
  status: LineStatus;
  confidence: Confidence | null;
}

export interface RecipePrepMinutes {
  minutes: number;
  lines: RecipePrepLine[];
  timedItems: number;
  totalItems: number;
  /** The weakest confidence among items carrying ≥ 10% of the minutes. */
  confidence: Confidence | null;
}

const RANK: Record<Confidence, number> = { needs_more_data: 0, settling: 1, confident: 2 };

export function recipePrepMinutes(usage: ReadonlyArray<PrepUsage>, timings: ReadonlyMap<string, ItemTiming>): RecipePrepMinutes {
  const lines: RecipePrepLine[] = usage.map(u => {
    const t = timings.get(u.itemKey);
    if (!t) return { itemKey: u.itemKey, minutes: null, status: "not_measured", confidence: null };
    if (u.grams != null && t.rate.minutesPerKg != null) {
      return { itemKey: u.itemKey, minutes: (u.grams / 1000) * t.rate.minutesPerKg, status: "timed", confidence: t.confidence };
    }
    if (u.count != null && t.rate.minutesPerCount != null && t.rate.countUnit === u.countUnit) {
      return { itemKey: u.itemKey, minutes: u.count * t.rate.minutesPerCount, status: "timed", confidence: t.confidence };
    }
    return { itemKey: u.itemKey, minutes: null, status: "no_matching_amount", confidence: t.confidence };
  });
  const minutes = lines.reduce((n, l) => n + (l.minutes ?? 0), 0);
  let confidence: Confidence | null = null;
  for (const l of lines) {
    if (l.status !== "timed" || l.confidence == null || l.minutes == null) continue;
    if (minutes > 0 && l.minutes < minutes * 0.1) continue;
    if (confidence == null || RANK[l.confidence] < RANK[confidence]) confidence = l.confidence;
  }
  return {
    minutes,
    lines,
    timedItems: lines.filter(l => l.status === "timed").length,
    totalItems: lines.length,
    confidence,
  };
}

export interface BatchCosting {
  /** List price of one pack. */
  rrp: number;
  /** Ingredient cost of one pack. */
  packIngredientCost: number;
  /** Packaging cost of one pack. */
  packagingCost: number;
  packsPerBatch: number;
}

/** (list price − cost per pack incl. packaging) × packs per batch. */
export function grossPerBatch(c: BatchCosting): number {
  return (c.rrp - c.packIngredientCost - c.packagingCost) * c.packsPerBatch;
}

/** Prep minutes at £/hour. */
export function prepLabourCost(minutes: number, ratePerHour: number): number {
  return (minutes / 60) * ratePerHour;
}

export interface BatchProfit {
  gross: number;
  prepLabour: number;
  profitAfterPrep: number;
  /** Prep labour as a share of gross (0.12 = 12%); null when gross ≤ 0. */
  prepShareOfGross: number | null;
}

export function batchProfit(costing: BatchCosting, prepMinutes: number, ratePerHour: number): BatchProfit {
  const gross = grossPerBatch(costing);
  const prepLabour = prepLabourCost(prepMinutes, ratePerHour);
  return {
    gross,
    prepLabour,
    profitAfterPrep: gross - prepLabour,
    prepShareOfGross: gross > 0 ? prepLabour / gross : null,
  };
}
