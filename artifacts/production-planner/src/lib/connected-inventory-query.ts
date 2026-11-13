/**
 * How the ingredient form asks for an item's Connected Inventory settings.
 *
 * Regression (Graeme, 13 Nov 2026, Honey Sriracha 190g): linking a Shopify
 * variant made the box ask the server BEFORE the link was saved ("not linked
 * yet"); the app keeps answers for 30 seconds, so reopening the item after
 * Save showed that old answer — "Press Save Changes to keep the Shopify
 * link" — though the link was saved. The answer is always fetched fresh when
 * the item opens.
 */
export function connectedInventoryQueryKey(ingredientId: number) {
  return ["connected-inventory", ingredientId] as const;
}

export const CONNECTED_INVENTORY_QUERY_OPTIONS = {
  staleTime: 0,
  refetchOnMount: "always",
} as const;
