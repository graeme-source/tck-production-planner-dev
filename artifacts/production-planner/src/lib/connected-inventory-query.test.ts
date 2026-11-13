import { describe, it, expect } from "vitest";
import { CONNECTED_INVENTORY_QUERY_OPTIONS, connectedInventoryQueryKey } from "./connected-inventory-query";

// Regression (13 Nov 2026): a saved Shopify link showed "Press Save Changes"
// because a 30-second-old answer from before the save was reused.
describe("Connected Inventory settings are always asked fresh", () => {
  it("never reuses a cached answer when the item opens", () => {
    expect(CONNECTED_INVENTORY_QUERY_OPTIONS.staleTime).toBe(0);
    expect(CONNECTED_INVENTORY_QUERY_OPTIONS.refetchOnMount).toBe("always");
  });
  it("one key per item, so items can't share an answer", () => {
    expect(connectedInventoryQueryKey(252)).toEqual(["connected-inventory", 252]);
    expect(connectedInventoryQueryKey(252)).not.toEqual(connectedInventoryQueryKey(203));
  });
});
