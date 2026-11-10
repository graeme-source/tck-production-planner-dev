import { describe, it, expect } from "vitest";
import { connectedInventoryLabel } from "./connected-inventory-label";

describe("connectedInventoryLabel", () => {
  it("says what's on the shelf and the maximum", () => {
    expect(connectedInventoryLabel({ onHandUnits: 14, inboundUnits: 0, maxUnits: 48, unitsPerPack: 6 })).toBe("Shopify 14 · fills to 48");
    expect(connectedInventoryLabel({ onHandUnits: 14, inboundUnits: 12, maxUnits: 48, unitsPerPack: 6 })).toBe("Shopify 14 + 12 on the way · fills to 48");
    expect(connectedInventoryLabel({ onHandUnits: -2, inboundUnits: 0, maxUnits: 24, unitsPerPack: 12 })).toBe("Shopify 0 · fills to 24");
  });
  it("owns up when Shopify didn't answer", () => {
    expect(connectedInventoryLabel({ onHandUnits: null, inboundUnits: 0, maxUnits: 48, unitsPerPack: 6 })).toMatch(/didn't load/);
    expect(connectedInventoryLabel(null)).toBeNull();
  });
});
