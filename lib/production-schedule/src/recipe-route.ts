/**
 * A recipe's PRODUCTION ROUTE — the per-recipe flags (migration 0202) that
 * let a product take a different path through the kitchen without any
 * product name in code (Development Charter rule 8). Pure: server + browser.
 *
 * Graeme, 16 Oct 2026, cinnamon buns: "dough → sheeting → building →
 * straight to wrapping" (proofed and baked by hand for now), wrapped into the
 * freezer, +N packs to Shopify on each wrap, not in the calzone KPIs, but
 * using the day's capacity — "48 packs of buns ≈ 20 calzone batches".
 *
 *   skipOvens               no ovens step: wrapping follows building.
 *   defaultStorage          where wrapping sends packs unless flipped.
 *   shopifyPushOnWrap       each freezer add at wrapping → +N on Shopify.
 *   excludeFromKpis         out of the calzone KPIs (still on the stations).
 *   calzoneBatchEquivalent  calzone batches of capacity ONE batch uses
 *                           (null = 1, i.e. every existing recipe).
 */
import { FRIED_CHICKEN_CATEGORY, isMainKitchen, kitchenLine, type KitchenLine } from "./kitchen-scope";

export type DefaultStorage = "fridge" | "freezer";

export interface RecipeRoute {
  skipOvens: boolean;
  defaultStorage: DefaultStorage;
  shopifyPushOnWrap: boolean;
  excludeFromKpis: boolean;
  /** Null = one calzone batch of capacity per batch. */
  calzoneBatchEquivalent: number | null;
  /** Grams each billet is portioned to (migration 0203); null = dough per batch. */
  billetWeightG: number | null;
}

/** How every recipe behaved before the route existed. */
export const STANDARD_ROUTE: RecipeRoute = Object.freeze({
  skipOvens: false,
  defaultStorage: "fridge",
  shopifyPushOnWrap: false,
  excludeFromKpis: false,
  calzoneBatchEquivalent: null,
  billetWeightG: null,
}) as RecipeRoute;

/** The raw shape as it arrives from the DB / API (numerics as strings). */
export interface RecipeRouteSource {
  skipOvens?: boolean | null;
  defaultStorage?: string | null;
  shopifyPushOnWrap?: boolean | null;
  excludeFromKpis?: boolean | null;
  calzoneBatchEquivalent?: number | string | null;
  billetWeightG?: number | string | null;
}

/** Normalise whatever the API/DB gave us; anything missing = standard. */
export function readRecipeRoute(src: RecipeRouteSource | null | undefined): RecipeRoute {
  if (!src) return { ...STANDARD_ROUTE };
  const eq = src.calzoneBatchEquivalent;
  const eqNum = eq === null || eq === undefined || eq === "" ? null : Number(eq);
  return {
    skipOvens: src.skipOvens === true,
    defaultStorage: src.defaultStorage === "freezer" ? "freezer" : "fridge",
    shopifyPushOnWrap: src.shopifyPushOnWrap === true,
    excludeFromKpis: src.excludeFromKpis === true,
    calzoneBatchEquivalent: eqNum !== null && Number.isFinite(eqNum) && eqNum >= 0 ? eqNum : null,
    billetWeightG: billetGrams(src.billetWeightG),
  };
}

/** Whole grams per billet, or null when unset / not a positive number. */
export function billetGrams(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The weight each billet is portioned to: the recipe's billet weight when
 * set, else the dough made per batch (Graeme, 19 Oct 2026: bun dough is made
 * at 2,544 g a batch but portioned at 2,467 g — the difference is the spare
 * for wastage, so the mix maths stay on the dough per batch).
 */
export function billetPortionG(doughKgPerBatch: number, billetWeightG: number | string | null | undefined): number {
  return billetGrams(billetWeightG) ?? Math.round((Number(doughKgPerBatch) || 0) * 1000);
}

// ── Station chain ───────────────────────────────────────────────────────────

export const BUILDING_STATIONS = ["building_1", "building_2"] as const;

/**
 * The stations whose completed batches a station may not get ahead of (the
 * server's cascade check). Building and the mac cheese line start the chain.
 * Standard: building → ovens → wrapping. skipOvens: building → wrapping.
 */
export function feedingStations(stationType: string, route: Pick<RecipeRouteSource, "skipOvens"> | null | undefined): string[] {
  switch (stationType) {
    case "ovens": return [...BUILDING_STATIONS];
    case "wrapping": return route?.skipOvens ? [...BUILDING_STATIONS] : ["ovens"];
    default: return [];
  }
}

/** Does this recipe appear at the ovens station? */
export function goesThroughOvens(route: Pick<RecipeRouteSource, "skipOvens"> | null | undefined): boolean {
  return route?.skipOvens !== true;
}

// ── Pack maths ──────────────────────────────────────────────────────────────

/**
 * Packs in one full batch, in the recipe's OWN pack size — whole packs,
 * at least 1. Falls back to a pack of 2 only when pack size is missing or 0
 * (the calzone convention), so calzones are untouched. A sheet of 48 buns in
 * packs of 6 is 8 packs, not 24.
 */
export function packsPerBatch(portionsPerBatch: number | string | null | undefined, packSize: number | string | null | undefined): number {
  const portions = Number(portionsPerBatch) || 10;
  const size = Number(packSize) || 2;
  return Math.max(1, Math.floor(portions / size));
}

/** Whole packs from a number of batches (same fallbacks as packsPerBatch). */
export function packsFromBatches(batches: number, portionsPerBatch: number | string | null | undefined, packSize: number | string | null | undefined): number {
  const portions = Number(portionsPerBatch) || 10;
  const size = Number(packSize) || 2;
  return Math.max(0, Math.floor((batches * portions) / size));
}

/** Batches needed for a number of packs (rounded up). */
export function batchesForPacks(packs: number, portionsPerBatch: number | string | null | undefined, packSize: number | string | null | undefined): number {
  const ppb = packsPerBatch(portionsPerBatch, packSize);
  return packs > 0 ? Math.ceil(packs / ppb) : 0;
}

// ── KPIs ────────────────────────────────────────────────────────────────────

/**
 * The kitchen line a recipe counts under for KPIs: a recipe flagged
 * excludeFromKpis is "separate" (outside every production KPI) even though
 * it is made on the main-kitchen stations. Use this — not kitchenLine — for
 * pace, team efficiency, defects and calzone batch counts.
 */
export function kpiKitchenLine(category: string | null | undefined, excludeFromKpis: boolean | null | undefined): KitchenLine {
  return excludeFromKpis ? "separate" : kitchenLine(category);
}

/** True when the recipe counts in the main-kitchen KPIs. */
export function countsInKpis(category: string | null | undefined, excludeFromKpis: boolean | null | undefined): boolean {
  return kpiKitchenLine(category, excludeFromKpis) !== "separate";
}

// ── Capacity ────────────────────────────────────────────────────────────────

export interface CapacityItem {
  category: string | null | undefined;
  batchesTarget: number | string | null | undefined;
  calzoneBatchEquivalent?: number | string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Calzone batches of day capacity one plan item uses (0 outside the main kitchen). */
export function capacityBatchesFor(item: CapacityItem): number {
  if (!isMainKitchen(item.category)) return 0;
  const batches = Number(item.batchesTarget) || 0;
  const eq = item.calzoneBatchEquivalent;
  const factor = eq === null || eq === undefined || eq === "" || !Number.isFinite(Number(eq)) ? 1 : Number(eq);
  return batches * factor;
}

/** Day capacity used by a plan, rounded to 2 dp so 6 × 3.333333 reads 20. */
export function capacityUsed(items: readonly CapacityItem[]): number {
  return round2(items.reduce((s, i) => s + capacityBatchesFor(i), 0));
}

export interface CapacityBreakdownItem extends CapacityItem {
  name: string;
  portionsPerBatch?: number | string | null;
  packSize?: number | string | null;
}

export interface CapacityBreakdown {
  /** Batches that count one-for-one (calzones; mac cheese packs). */
  standardBatches: number;
  /** Recipes with their own equivalence, in packs. */
  equivalents: Array<{ name: string; batches: number; packs: number; capacity: number }>;
  total: number;
}

/**
 * "90 calzone + 48 bun packs = 110": what makes up the day's capacity.
 * Recipes with an equivalence are listed separately in packs.
 */
export function capacityBreakdown(items: readonly CapacityBreakdownItem[]): CapacityBreakdown {
  let standard = 0;
  const byName = new Map<string, { name: string; batches: number; packs: number; capacity: number }>();
  for (const it of items) {
    if (!isMainKitchen(it.category)) continue;
    const batches = Number(it.batchesTarget) || 0;
    if (batches <= 0) continue;
    const eq = it.calzoneBatchEquivalent;
    if (eq === null || eq === undefined || eq === "") { standard += batches; continue; }
    const row = byName.get(it.name) ?? { name: it.name, batches: 0, packs: 0, capacity: 0 };
    row.batches += batches;
    row.packs += packsFromBatches(batches, it.portionsPerBatch, it.packSize);
    row.capacity = round2(row.capacity + capacityBatchesFor(it));
    byName.set(it.name, row);
  }
  const equivalents = [...byName.values()];
  return { standardBatches: standard, equivalents, total: round2(standard + equivalents.reduce((s, e) => s + e.capacity, 0)) };
}

/** One line for screens: "90 batches + 48 packs Cinnamon Buns (≈20) = 110". */
export function formatCapacityBreakdown(b: CapacityBreakdown): string {
  if (b.equivalents.length === 0) return `${fmt(b.total)}`;
  const parts = [`${fmt(b.standardBatches)} batches`, ...b.equivalents.map(e => `${e.packs} packs ${e.name} (≈${fmt(e.capacity)})`)];
  return `${parts.join(" + ")} = ${fmt(b.total)}`;
}

function fmt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// ── Stock source ────────────────────────────────────────────────────────────

/**
 * Recipes whose physical stock is the Shopify on-hand figure rather than the
 * production fridge: fried chicken (its own facility) and anything wrapped
 * straight to Shopify (shopifyPushOnWrap).
 */
export function usesShopifyStock(category: string | null | undefined, shopifyPushOnWrap: boolean | null | undefined): boolean {
  return category === FRIED_CHICKEN_CATEGORY || shopifyPushOnWrap === true;
}
