/**
 * Row keying for the Stock Control snapshot (pure — no DB).
 *
 * Stock Control reads stock_entries as snapshots: the NEWEST row per item
 * and location is the current level. A recipe in the production fridge has
 * two independent stocks — 2-packs and 8-pack bags — so the key MUST carry
 * the pack size. Keyed by recipe alone, a freshly-wrapped bag row was the
 * newest entry for its recipe and Stock Control showed the BAG count as the
 * recipe's 2-pack number (the reason bags used to be hidden entirely).
 */
import { EIGHT_PACK_SIZE } from "./eight-pack-bags";

export interface SnapshotRowLike {
  location: string;
  itemType: string;
  recipeId: number | null;
  ingredientId: number | null;
  packSize: number | null;
}

/** True for a recipe row holding 8-pack bags. */
export function isBagRow(r: Pick<SnapshotRowLike, "itemType" | "packSize">): boolean {
  return r.itemType === "recipe" && Number(r.packSize) === EIGHT_PACK_SIZE;
}

/** Snapshot key: location + item + (for recipes) packs-vs-bags. Every
 *  non-bag recipe row shares the packs key, as before. */
export function stockRowKey(r: SnapshotRowLike): string {
  if (r.itemType === "recipe") {
    return `${r.location}|r:${r.recipeId}|${isBagRow(r) ? "bags" : "packs"}`;
  }
  return `${r.location}|i:${r.ingredientId}`;
}

/** Keep the first (newest) row per key. Input must be newest-first. */
export function latestRowPerKey<T extends SnapshotRowLike>(rowsNewestFirst: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rowsNewestFirst) {
    const k = stockRowKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** Display name for a bag row. */
export function bagRowName(recipeName: string): string {
  return `${recipeName} — 8-pack bags`;
}
