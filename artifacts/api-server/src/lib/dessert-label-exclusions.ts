/**
 * Leaving orders out of the dessert labels (Graeme, 27 Nov 2026): once some
 * APC labels are booked, the dessert labels print for those orders only —
 * an order with a booking issue (or not yet booked) likely isn't going
 * today, so its desserts aren't labelled. Order Packing Live sends the ids
 * of the orders still without a label; the labels "still needed" for the
 * day then cover the rest, and a later print picks up any of them that do
 * get booked. Pure; tested.
 */

/** "123,456" (a query string) or [123, 456] (a body) → the set of ids. */
export function parseExcludedOrderIds(raw: unknown): Set<number> {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const out = new Set<number>();
  for (const p of parts) {
    const n = Number(typeof p === "string" ? p.trim() : p);
    if (Number.isSafeInteger(n) && n > 0) out.add(n);
  }
  return out;
}

export function withoutExcluded<T extends { id: number | string }>(orders: T[], exclude: ReadonlySet<number>): T[] {
  return exclude.size ? orders.filter(o => !exclude.has(Number(o.id))) : orders;
}
