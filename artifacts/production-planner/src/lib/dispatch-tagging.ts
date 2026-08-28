/** Step one of the packing day: approving the day's orders for dispatch.
 *
 *  This lives outside the page because the rule it encodes is easy to get
 *  wrong and expensive when it is: the tag button used to inherit the pick
 *  filters below it, so a packer who had narrowed the list to one box size
 *  would tag only that slice and silently leave the rest of the day
 *  untagged — and an untagged order never gets an APC label (Graeme,
 *  2026-08-26). Tagging now has its own scope, defaulting to every untagged
 *  order of the day, and knows nothing about the pick filters.
 */

export type BoxCategory = "small box" | "large box" | "wholesale" | "local delivery" | "collection" | "other";

/** What the tag button will act on: the whole day, or one box size. */
export type TagScope = "all" | BoxCategory;

/** Orders tagged local-delivery go on the van, not APC — no consignment to
 *  book or look up, no label to print or verify. The tag is put on the order
 *  in Shopify when the local delivery is arranged. */
export const LOCAL_DELIVERY_TAG = "local-delivery";

/** Orders the customer collects from the unit (Graeme's website collections
 *  feature, 2026-08-28): packed into a BROWN PAPER BAG, never a box, bag
 *  label stuck on, left in the fridge. Never booked with APC. The website
 *  applies the tag at checkout. */
export const COLLECTION_TAGS = ["collections", "collection", "collection order"];

/** The Shopify tag that means "approved to go out today". */
export const DISPATCH_TAG = "dispatch";

/** Shopify hands tags back as one comma-separated string, cased however they
 *  were typed. Everything here compares lower-cased and trimmed. */
export function orderTags(tags: string): string[] {
  return tags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
}

export function isLocalDelivery(order: { tags: string }): boolean {
  return orderTags(order.tags).includes(LOCAL_DELIVERY_TAG);
}

export function isCollection(order: { tags: string }): boolean {
  const tags = orderTags(order.tags);
  return COLLECTION_TAGS.some(t => tags.includes(t));
}

export function isDispatchTagged(order: { tags: string }): boolean {
  return orderTags(order.tags).includes(DISPATCH_TAG);
}

export function boxCategoryOf(order: { tags: string }): BoxCategory {
  const tags = orderTags(order.tags);
  // Collection wins over everything — it never leaves the building in a
  // box; then local delivery — however big, it goes on the van.
  if (COLLECTION_TAGS.some(t => tags.includes(t))) return "collection";
  if (tags.includes(LOCAL_DELIVERY_TAG)) return "local delivery";
  if (tags.includes("wholesale")) return "wholesale";
  if (tags.includes("large box")) return "large box";
  if (tags.includes("small box")) return "small box";
  return "other";
}

/** The orders the tag button will tag. `all` is the default and the normal
 *  day: every order still awaiting approval, whatever the pick filters
 *  below happen to be showing. */
export function ordersForTagging<T extends { tags: string }>(orders: T[], scope: TagScope): T[] {
  const untagged = orders.filter(o => !isDispatchTagged(o));
  return scope === "all" ? untagged : untagged.filter(o => boxCategoryOf(o) === scope);
}
