/**
 * Wholesale / 8-pack order tags — which orders the dashboard's wholesale
 * list still needs to process. Pure, tested (wholesale-order-tags.test.ts).
 *
 * Processing an order adds its delivery-date tag ("2026-11-04") AND
 * "production" together, so an order is processed only when it has BOTH
 * (Graeme, 2 Nov 2026). Before, "production" alone hid it: #138553 was made
 * as a draft order in Shopify with tags copied from an older order —
 * "production" but no delivery date — so it never showed to be processed
 * and, with no date, never reached packing either. "Production" alone can't
 * be the signal on its own, and nor can the date alone: retail 8-pack
 * orders arrive with the date the customer picked at checkout and still
 * need their bags put on a plan.
 */
export const PRODUCTION_TAG = "production";
export const WHOLESALE_TAG = "wholesale";
export const DATE_TAG_RE = /^\d{4}-\d{2}-\d{2}$/;

const tagList = (tags: string | null | undefined) => (tags ?? "").split(",").map(t => t.trim()).filter(Boolean);

export function firstDateTag(tags: string | null | undefined): string | null {
  for (const t of tagList(tags)) if (DATE_TAG_RE.test(t)) return t;
  return null;
}
export function hasProductionTag(tags: string | null | undefined): boolean {
  return tagList(tags).some(t => t.toLowerCase() === PRODUCTION_TAG);
}
export function hasWholesaleTag(tags: string | null | undefined): boolean {
  return tagList(tags).some(t => t.toLowerCase() === WHOLESALE_TAG);
}

/** Processed = "production" AND a delivery date — what processing adds. */
export function isProcessedOrder(tags: string | null | undefined): boolean {
  return hasProductionTag(tags) && firstDateTag(tags) != null;
}
