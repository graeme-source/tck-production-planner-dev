/**
 * What a wasted item cost — ingredients, time to make it again, and what it
 * takes off the day's efficiency (Graeme, 2026-10-09; Objectives C and E).
 * Pure, no I/O: services/waste-costing.ts loads the inputs from the existing
 * costing (computeSubRecipeCosts, computeCosts) and Team efficiency.
 *
 *   Ingredient   amount (in the ingredient's own unit, via @workspace/units)
 *                × cost_per_pack ÷ pack_weight — the same per-unit cost
 *                every recipe costing uses.
 *   Sub-recipe   amount (in its yield unit) × its cost per yield unit
 *                (computeSubRecipeCosts: batch ingredient cost ÷ yield).
 *   Pack         materials = packs × (ingredient cost per pack + packaging),
 *                the recipe page's own figures. Its LOST VALUE is what Team
 *                efficiency credited it with when it was made: RRP less the
 *                line's discount (8-pack bags at the 8-pack factor), times
 *                the made share (1 − despatch share) — a binned pack is
 *                never despatched, so it never earned the despatch share.
 *   Time         remake minutes ÷ 60 × the team's real average hourly
 *                production labour cost (hourlyLabourRate).
 *
 * Lost value (what comes off the efficiency day) is ingredient cost for
 * ingredients and sub-recipes, credited value for packs — NEVER the time:
 * remaking it is paid in that day's labour already, and produces nothing
 * new, so deducting the time as well would count it twice.
 *
 * No product, recipe or category names in here.
 */
import { convertQuantity, isWeighable } from "@workspace/units";
import { creditedValue } from "./team-efficiency";
import { bagPacks, lineNetValue, type TeSettings } from "./team-efficiency-day";

export type WasteItemKind = "ingredient" | "sub_recipe" | "product";
export type PackKind = "pack" | "eight_pack_bag";

const pennies = (n: number) => Math.round(n * 100) / 100;

// ── What can be entered ───────────────────────────────────────────────────

/**
 * The units an amount may be entered in for an ingredient or sub-recipe:
 * kg and g for anything weighed (volumes too, at density 1 — and their own
 * l/ml first), otherwise just the item's own count unit ("each", "box").
 */
export function wasteUnitsFor(ownUnit: string): string[] {
  const own = ownUnit.trim().toLowerCase();
  if (!isWeighable(own)) return [ownUnit.trim() || "each"];
  const out = own === "kg" || own === "g" ? [] : [own];
  return [...out, "kg", "g"];
}

/** "2-pack" for a recipe whose pack holds 2; "Single pack" for 1. */
export function packLabel(packSize: number): string {
  return packSize > 1 ? `${Number(packSize.toFixed(2))}-pack` : "Single pack";
}

// ── Ingredients ───────────────────────────────────────────────────────────

export interface IngredientBasis {
  /** The ingredient's own unit (kg, g, l, each…). */
  unit: string;
  costPerPack: number;
  /** Pack size in the ingredient's own unit. */
  packWeight: number;
}

/** £ per one of the ingredient's own units; null when the pack size isn't set. */
export function costPerIngredientUnit(i: IngredientBasis): number | null {
  if (!(i.packWeight > 0) || !Number.isFinite(i.costPerPack)) return null;
  return i.costPerPack / i.packWeight;
}

/** £ of ingredient wasted; null when it can't be priced (no pack size, or
 *  an amount in a unit that can't become the ingredient's own — 3 each of
 *  something bought by the kg). */
export function ingredientWasteCost(qty: number, qtyUnit: string, i: IngredientBasis): number | null {
  const perUnit = costPerIngredientUnit(i);
  const inOwnUnit = convertQuantity(qty, qtyUnit, i.unit);
  if (perUnit === null || inOwnUnit === null) return null;
  return inOwnUnit * perUnit;
}

// ── Sub-recipes ───────────────────────────────────────────────────────────

export interface SubRecipeBasis {
  yieldUnit: string;
  /** One batch's yield, in yieldUnit. */
  batchYield: number;
  /** £ per yieldUnit (computeSubRecipeCosts). */
  costPerYieldUnit: number;
  /** Minutes to make one batch; null = not known. */
  standardPrepMinutes: number | null;
}

/** How many batches the amount is (2.3 kg of a 0.414 kg batch = 5.56). */
export function batchesOf(qty: number, qtyUnit: string, s: SubRecipeBasis): number | null {
  const inYieldUnit = convertQuantity(qty, qtyUnit, s.yieldUnit);
  if (inYieldUnit === null || !(s.batchYield > 0)) return null;
  return inYieldUnit / s.batchYield;
}

export function subRecipeWasteCost(qty: number, qtyUnit: string, s: SubRecipeBasis): number | null {
  const inYieldUnit = convertQuantity(qty, qtyUnit, s.yieldUnit);
  if (inYieldUnit === null || !Number.isFinite(s.costPerYieldUnit)) return null;
  return inYieldUnit * s.costPerYieldUnit;
}

/** Standard prep minutes scaled to the amount, to the nearest minute;
 *  null when there's no standard time (the form asks instead). */
export function standardRemakeMinutes(qty: number, qtyUnit: string, s: SubRecipeBasis): number | null {
  if (s.standardPrepMinutes == null || !(s.standardPrepMinutes > 0)) return null;
  const batches = batchesOf(qty, qtyUnit, s);
  if (batches === null) return null;
  return Math.max(1, Math.round(s.standardPrepMinutes * batches));
}

// ── Finished packs ────────────────────────────────────────────────────────

export interface ProductBasis {
  /** Portions in the recipe's own pack (2 = a 2-pack). */
  packSize: number;
  rrp: number;
  /** The line (recipe category) — its discount rate is data, in settings. */
  category: string | null;
  /** The recipe page's ingredient cost of one pack. */
  ingredientCostPerPack: number;
  packagingCostPerPack: number;
}

/** The amount in the recipe's own packs (an 8-pack bag of 2-packs = 4). */
export function productPacks(count: number, packKind: PackKind, packSize: number): number {
  return packKind === "eight_pack_bag" ? count * bagPacks(packSize) : count;
}

/** Ingredients + packaging of the packs. */
export function productMaterialCost(count: number, packKind: PackKind, p: ProductBasis): number {
  return productPacks(count, packKind, p.packSize) * (p.ingredientCostPerPack + p.packagingCostPerPack);
}

/** What Team efficiency credited the packs with when they were made. */
export function productLostValue(count: number, packKind: PackKind, p: ProductBasis, s: TeSettings): number {
  const gross = packKind === "pack" ? count * p.rrp : 0;
  const bagGross = packKind === "eight_pack_bag" ? count * bagPacks(p.packSize) * p.rrp : 0;
  return creditedValue(lineNetValue(s, p.category, gross, bagGross), 0, s.despatchShare);
}

/** Packs the record adds to the Defects KPI: whole packs for products
 *  (at least 1), 0 for ingredient and sub-recipe waste — a kilo of sauce
 *  isn't a defective pack. */
export function defectPacksFor(kind: WasteItemKind, count: number, packKind: PackKind | null, packSize: number): number {
  if (kind !== "product") return 0;
  return Math.max(1, Math.round(productPacks(count, packKind ?? "pack", packSize)));
}

// ── Time ──────────────────────────────────────────────────────────────────

export interface LabourDayInput {
  date: string;
  status: string;
  /** Productive pay × on-cost (holiday, NI, pension), before line removal. */
  labourCostTotal: number;
  paidHours: number;
}

export interface HourlyRate {
  /** £ per paid production hour, on-costs included. */
  rate: number;
  from: string;
  to: string;
  days: number;
}

/** Days of approved production labour the hourly rate is averaged over. */
export const HOURLY_RATE_WINDOW_DAYS = 28;

/**
 * The team's real average hourly production labour cost: total cost ÷ total
 * paid hours over the stored Team efficiency days in the window (a ratio of
 * sums, so a long day weighs more than a short one). Days still waiting for
 * Planday approval are left out. Null when there's nothing to go on.
 */
export function hourlyLabourRate(days: LabourDayInput[]): HourlyRate | null {
  const kept = days.filter(d => d.status !== "pending" && d.paidHours > 0 && d.labourCostTotal > 0);
  const hours = kept.reduce((n, d) => n + d.paidHours, 0);
  const cost = kept.reduce((n, d) => n + d.labourCostTotal, 0);
  if (!(hours > 0)) return null;
  const dates = kept.map(d => d.date).sort();
  return { rate: cost / hours, from: dates[0], to: dates[dates.length - 1], days: kept.length };
}

export function remakeTimeCost(minutes: number, hourlyRate: number): number {
  return (Math.max(0, minutes) / 60) * hourlyRate;
}

// ── The snapshot saved on the record ──────────────────────────────────────

export interface WasteSnapshot {
  /** £ ingredients (and packaging, for packs); null = couldn't be priced. */
  ingredientCost: number | null;
  /** £ of remake time; null = no hourly rate to price it with. */
  timeCost: number | null;
  totalCost: number | null;
  /** £ off the day's efficiency credited value. */
  lostValue: number | null;
  remakeMinutes: number;
  hourlyRate: number | null;
}

export function wasteSnapshot(input: {
  ingredientCost: number | null;
  lostValue: number | null;
  remakeMinutes: number;
  hourlyRate: number | null;
}): WasteSnapshot {
  const minutes = Math.max(0, Math.round(input.remakeMinutes));
  const timeCost = minutes === 0 ? 0 : input.hourlyRate == null ? null : pennies(remakeTimeCost(minutes, input.hourlyRate));
  const ingredientCost = input.ingredientCost == null ? null : pennies(input.ingredientCost);
  const totalCost = ingredientCost == null && timeCost == null ? null : pennies((ingredientCost ?? 0) + (timeCost ?? 0));
  return {
    ingredientCost,
    timeCost,
    totalCost,
    lostValue: input.lostValue == null ? null : pennies(input.lostValue),
    remakeMinutes: minutes,
    hourlyRate: input.hourlyRate,
  };
}

/** £ to take off each day's credited value: the recorded lost value of the
 *  day's entries. Old records (no lost value) take nothing off. */
export function wasteByDay(rows: Array<{ occurredOn: string; lostValue: number | null }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const v = Number(r.lostValue);
    if (!(v > 0)) continue;
    out.set(r.occurredOn, pennies((out.get(r.occurredOn) ?? 0) + v));
  }
  return out;
}
