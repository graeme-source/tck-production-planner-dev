/**
 * Giving a Shopify product with no cost a cost, from the order pop-up in
 * Order Analysis (Graeme, 25 Nov 2026: "click on this product and set the
 * price in our system … if we should have mapping and we haven't, we can
 * set the mapping from here"). The rules; pure. The writes are in
 * services/variant-costs.ts. Objective I.
 */

/** A Shopify numeric variant id (the REST id, not a gid). */
export const VARIANT_ID_RE = /^\d{5,20}$/;

/**
 * Tick "Also set this as the cost per item in Shopify" by default only when
 * Shopify has no cost for it — never quietly overwrite one that's there.
 */
export function shopifyCostTickDefault(shopifyCost: number | null | undefined): boolean {
  return !(Number(shopifyCost) > 0);
}

/**
 * The cost as Shopify takes it: pounds to the penny. Null when it would be
 * nothing — a cost under half a penny (1.6p inserts are fine; 0.4p isn't)
 * stays in the app only rather than writing £0.00 to Shopify.
 */
export function shopifyCostString(cost: number): string | null {
  if (!Number.isFinite(cost)) return null;
  const s = cost.toFixed(2);
  return Number(s) > 0 ? s : null;
}

export interface MainMappingRow {
  id: number;
  variantId: string;
  title: string | null;
  wonkyVariantId: string | null;
}

export type WonkyTarget =
  | { ok: true; mappingId: number }
  | { ok: false; reason: "no-main" | "choose" | "not-this-recipe" | "has-wonky"; message: string };

/**
 * Which of a recipe's main Shopify links a wonky product goes on: the only
 * one, or the one the person chose when the recipe has several. A link that
 * already has a different wonky product is left alone — replacing it would
 * leave that one uncosted.
 */
export function wonkyTarget(rows: readonly MainMappingRow[], wonkyVariantId: string, chosenMappingId?: number | null): WonkyTarget {
  if (rows.length === 0) return { ok: false, reason: "no-main", message: "This recipe has no main Shopify product yet, so a wonky one can't go with it. Link its main product first." };
  let row: MainMappingRow | undefined;
  if (chosenMappingId != null) {
    row = rows.find(r => r.id === chosenMappingId);
    if (!row) return { ok: false, reason: "not-this-recipe", message: "That Shopify product isn't one of this recipe's." };
  } else if (rows.length === 1) {
    row = rows[0];
  } else {
    return { ok: false, reason: "choose", message: "This recipe has more than one Shopify product. Pick which one this is the wonky version of." };
  }
  if (row!.wonkyVariantId && row!.wonkyVariantId !== wonkyVariantId) {
    return { ok: false, reason: "has-wonky", message: `${row!.title ?? "That product"} already has a wonky product. Change it on the recipe's Shopify links.` };
  }
  return { ok: true, mappingId: row!.id };
}

/**
 * What a supply link will do to its cost: the pack cost to use, or why it
 * can't. A typed cost is only used when the supply has none of its own —
 * this isn't the place to re-price a supply.
 */
export function supplyLinkCost(currentCostPerPack: number | null | undefined, typedCostPerPack: number | null | undefined):
  { ok: true; costPerPack: number; setsCost: boolean } | { ok: false; message: string } {
  const current = Number(currentCostPerPack);
  if (current > 0) return { ok: true, costPerPack: current, setsCost: false };
  const typed = Number(typedCostPerPack);
  if (typed > 0) return { ok: true, costPerPack: typed, setsCost: true };
  return { ok: false, message: "This supply has no cost per pack yet. Type what one pack costs." };
}
