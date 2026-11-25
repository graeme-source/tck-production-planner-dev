// Giving a "No cost" item in an Order Analysis order a cost (Graeme,
// 25 Nov 2026). Pure rules for the pop-up's panel; the server's are in
// api-server lib/variant-cost-rules.ts. Objective I.

/**
 * Only an item with no cost from anywhere (no recipe, supply, app or Shopify
 * cost) and a Shopify variant to hang it on gets the options. Digital items
 * are costed at £0 by the server, so they're never `costed: false`.
 */
export function canGiveCost(p: { costed: boolean; variantId: string | null }): boolean {
  return !p.costed && !!p.variantId;
}

/** Name search: every word typed appears in the name, in any order, ignoring case. */
export function matchesSearch(name: string, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const n = name.toLowerCase();
  return words.every(w => n.includes(w));
}

/** £ per Shopify item from a supply: pack cost ÷ items per pack. Null until both are real. */
export function perItemFromPack(costPerPack: number | null | undefined, unitsPerPack: number | null | undefined): number | null {
  const c = Number(costPerPack), u = Number(unitsPerPack);
  return c > 0 && u > 0 ? c / u : null;
}

/** A typed number, or null when it isn't a positive one. */
export function positiveNumber(s: string): number | null {
  const n = Number(s.trim().replace(/^£/, ""));
  return s.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

/** Pence for small amounts (1.6p), pounds otherwise (£1.20). */
export function formatUnitCost(n: number): string {
  return n < 0.1 ? `${(n * 100).toFixed(n < 0.01 ? 2 : 1)}p` : `£${n.toFixed(2)}`;
}
