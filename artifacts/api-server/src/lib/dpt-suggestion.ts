// Weekly DPT suggestion maths (pure — no DB, no network; the route feeds it).
//
// The DPT split's packs-sold numbers were hand-typed and went stale between
// edits. Once a week we suggest fresh numbers from the last 30 days of actual
// Shopify sales, for a manager/admin to confirm — never applied silently.
//
// The rotating special is EXCLUDED twice over (Graeme, 2026-08-25):
//  - any line whose product title is the special ("Calzone Club Special" —
//    the same title-routing convention as inventory-sync.ts), and
//  - any recipe currently flagged is_current_special.
// Specials rotate and have been taken off one-off orders, so a 30-day window
// would misattribute their history and skew every other recipe's share.

export const SPECIAL_TITLE_LC = "calzone club special";

export interface SuggestionOrder {
  cancelled_at?: string | null;
  line_items?: Array<{
    variant_id?: number | string | null;
    quantity?: number;
    title?: string | null;
  }> | null;
}

export interface VariantMapRow {
  recipeId: number;
  shopifyVariantId: string | null;
  wonkyVariantId: string | null;
  /** 8-pack bag variant — one unit = 4 two-packs (same equivalence as the
   *  plans page and the fulfilment fridge gate). */
  eightPackVariantId: string | null;
  isCurrentSpecial: boolean;
}

/** Total 2-pack-equivalent sales per recipe over the supplied orders. */
export function computeSalesPacksByRecipe(
  orders: SuggestionOrder[],
  mappings: VariantMapRow[],
): Map<number, number> {
  const byVariant = new Map<string, { recipeId: number; packsPerUnit: number; special: boolean }>();
  for (const m of mappings) {
    if (m.shopifyVariantId) byVariant.set(m.shopifyVariantId, { recipeId: m.recipeId, packsPerUnit: 1, special: m.isCurrentSpecial });
    if (m.wonkyVariantId) byVariant.set(m.wonkyVariantId, { recipeId: m.recipeId, packsPerUnit: 1, special: m.isCurrentSpecial });
    if (m.eightPackVariantId) byVariant.set(m.eightPackVariantId, { recipeId: m.recipeId, packsPerUnit: 4, special: m.isCurrentSpecial });
  }
  const totals = new Map<number, number>();
  for (const order of orders) {
    if (order.cancelled_at) continue;
    for (const li of order.line_items ?? []) {
      if ((li.title ?? "").toLowerCase().includes(SPECIAL_TITLE_LC)) continue;
      const mapped = li.variant_id != null ? byVariant.get(String(li.variant_id)) : undefined;
      if (!mapped || mapped.special) continue;
      totals.set(mapped.recipeId, (totals.get(mapped.recipeId) ?? 0) + (li.quantity ?? 0) * mapped.packsPerUnit);
    }
  }
  return totals;
}

/** packs-sold is kept as a weekly figure, so a 30-day total is scaled to a
 *  rounded weekly average — magnitudes stay comparable with the old numbers
 *  (only the proportions drive the batch split anyway). */
export function weeklyAverage(totalPacks: number, windowDays: number): number {
  if (!Number.isFinite(totalPacks) || windowDays <= 0) return 0;
  return Math.round((totalPacks * 7) / windowDays);
}
