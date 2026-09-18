/**
 * Totals across the tag groups the Numbers page already fetches.
 *
 * `/api/shopify/orders-by-type` returns one group per tag, each carrying its
 * own orders. Tags are not exclusive — an order can be tagged both
 * "Subscription New Order" and something else — so anything that adds two
 * groups together has to dedupe by order id first. Summing the groups'
 * totals directly would count a doubly-tagged order twice, which is exactly
 * the kind of quiet inflation nobody notices until the figure is used to
 * make a decision.
 *
 * These are the same numbers the page has always shown, just summed over a
 * chosen set of tags instead of one at a time.
 */

export interface TaggedOrder {
  id: number;
  total?: number | null;
}

export interface TagGroup {
  tag: string;
  orders: TaggedOrder[];
}

/** Every distinct order carrying any of `tags`, each counted once. */
function distinctOrders(groups: TagGroup[] | undefined, tags: readonly string[]): TaggedOrder[] {
  if (!groups) return [];
  const wanted = new Set(tags);
  const seen = new Map<number, TaggedOrder>();
  for (const group of groups) {
    if (!wanted.has(group.tag)) continue;
    for (const order of group.orders ?? []) {
      if (!seen.has(order.id)) seen.set(order.id, order);
    }
  }
  return [...seen.values()];
}

/**
 * Combined revenue of every order carrying any of `tags`.
 *
 * Returns null when the groups haven't loaded — null means "we don't know",
 * and the tiles render that as a dash rather than as £0.00.
 */
export function revenueForTags(groups: TagGroup[] | undefined, tags: readonly string[]): number | null {
  if (!groups) return null;
  return distinctOrders(groups, tags).reduce((sum, o) => {
    const total = typeof o.total === "number" && Number.isFinite(o.total) ? o.total : 0;
    return sum + total;
  }, 0);
}

/** How many distinct orders carry any of `tags`. */
export function countForTags(groups: TagGroup[] | undefined, tags: readonly string[]): number | null {
  if (!groups) return null;
  return distinctOrders(groups, tags).length;
}
