/**
 * Orders with no delivery (Graeme, 26 Nov 2026 — the used oil collection):
 * an order counts as "no delivery" only when every line on it is an item
 * marked No delivery. One ordinary item on it and the van is still coming,
 * so it goes to Deliveries as normal. Pure, tested. Objective C.
 */
export function isNoDeliveryOrder(lines: Array<{ ingredientId: number | null; noDelivery: boolean | null }>): boolean {
  return lines.length > 0 && lines.every(l => l.ingredientId != null && l.noDelivery === true);
}
