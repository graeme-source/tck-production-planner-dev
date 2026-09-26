import { describe, expect, it } from "vitest";
import {
  buildOrderMessage,
  costPerUnitLabel,
  hydratePlacedLine,
  lineOrderQty,
  lineTotal,
  orderQtyDisplay,
  packSizeLabel,
  palletPriceLabel,
  placedLineQuantity,
  type OrderLineForText,
} from "./order-line-text";

// Regression: Ice (Gel pack 500g) — 36 per box, £6.84 a box, 50 boxes a
// pallet, kanban 1 pallet — showed "36 pallets" on the Orders page and in
// the supplier email (Graeme, 2026-09-26). 1 pallet = 50 boxes = 1,800 each
// = £342.00.
const gelPack: OrderLineForText = {
  ingredientName: "Ice (Gel pack 500g)",
  supplierPartNumber: "150mm/200mm",
  unit: "each",
  packWeight: 36,
  costPerPack: 6.84,
  editedPacks: 50,
  orderInPallets: true,
  palletSize: 50,
};

describe("gel-pack pallet line", () => {
  it("Order Quantity reads '1 pallet' with '50 packs · 1,800 each' under it", () => {
    expect(orderQtyDisplay(gelPack)).toEqual({ primary: "1 pallet", detail: "50 packs · 1,800 each" });
  });

  it("line total is £342.00 and the pallet price is shown", () => {
    expect(lineTotal(gelPack)).toBe(342);
    expect(palletPriceLabel(gelPack)).toBe("£342.00/pallet");
    expect(costPerUnitLabel(gelPack)).toBe("£0.19 each");
  });

  it("editing packs keeps working: 100 packs → 2 pallets, 75 → 1.5 pallets (75 packs)", () => {
    expect(orderQtyDisplay({ ...gelPack, editedPacks: 100 }).primary).toBe("2 pallets");
    expect(orderQtyDisplay({ ...gelPack, editedPacks: 75 }).primary).toBe("1.5 pallets (75 packs)");
  });

  it("the supplier message is unambiguous and never says '36 pallets'", () => {
    const msg = buildOrderMessage("Thergis", [gelPack], "Tue 29/09");
    expect(msg).toContain("- 1 pallet (50 × 36 each) × Ice (Gel pack 500g) [150mm/200mm]");
    expect(msg).not.toContain("36 pallets");
    expect(lineOrderQty(gelPack)).toBe("1 pallet (50 × 36 each)");
  });

  it("Mark as Placed saves base units like every other line: 1,800 each at £6.84/pack", () => {
    expect(placedLineQuantity(gelPack)).toEqual({
      quantityOrdered: 1800,
      unit: "each",
      unitPrice: 6.84,
      notes: "1 pallet (50 × 36 each)",
    });
  });

  it("reopening the placed line gives back 50 packs of 36 (not 1,800 packs)", () => {
    expect(hydratePlacedLine({ quantityOrdered: 1800, unit: "each", isMisc: false, packWeight: "36.0000", palletSize: 50, nativeUnit: "each", kanbanUnit: "pallet" }))
      .toEqual({ unit: "each", packs: 50, packWeight: 36, orderInPallets: true, palletSize: 50 });
  });

  it("a legacy '1 pallets' line reopens as 50 packs in base units", () => {
    expect(hydratePlacedLine({ quantityOrdered: 1, unit: "pallets", isMisc: false, packWeight: 36, palletSize: 50, nativeUnit: "each", kanbanUnit: "pallet" }))
      .toEqual({ unit: "each", packs: 50, packWeight: 36, orderInPallets: true, palletSize: 50 });
  });
});

describe("pallet item with no pallet size", () => {
  const noSize = { ...gelPack, palletSize: null, palletSizeMissing: true, editedPacks: 1 };
  it("orders one pack and says so, rather than inventing a pallet", () => {
    expect(orderQtyDisplay(noSize)).toEqual({ primary: "36 each", detail: "1 pack" });
    expect(lineOrderQty(noSize)).toBe("36 each");
    expect(placedLineQuantity(noSize).quantityOrdered).toBe(36);
    expect(placedLineQuantity(noSize).notes).toBeNull();
  });
});

describe("Pack Size column uses the item's real unit", () => {
  const base = { ingredientName: "x", supplierPartNumber: null, costPerPack: 0, editedPacks: 1 };
  it("each / L / kg / g", () => {
    expect(packSizeLabel({ ...base, unit: "each", packWeight: 36 })).toBe("36 each");
    expect(packSizeLabel({ ...base, unit: "l", packWeight: 5 })).toBe("5 L");
    expect(packSizeLabel({ ...base, unit: "kg", packWeight: 2.5 })).toBe("2.5 kg");
    expect(packSizeLabel({ ...base, unit: "g", packWeight: 500 })).toBe("500g");
  });
  it("pack-counted lines use the native unit, misc lines show a dash", () => {
    expect(packSizeLabel({ ...base, unit: "packs", nativeUnit: "kg", packWeight: 2.27 })).toBe("2.27 kg");
    expect(packSizeLabel({ ...base, unit: "packs", packWeight: 2.27 })).toBe("—");
    expect(packSizeLabel({ ...base, unit: "each", packWeight: 1, isMisc: true })).toBe("—");
  });
});

describe("unchanged lines", () => {
  const flour: OrderLineForText = {
    ingredientName: "Flour", supplierPartNumber: null, unit: "kg", packWeight: 16, costPerPack: 12, editedPacks: 3,
  };
  it("weight lines still read base units and save base units", () => {
    expect(orderQtyDisplay(flour)).toEqual({ primary: "48 kg", detail: null });
    expect(lineOrderQty(flour)).toBe("48 kg");
    expect(placedLineQuantity(flour)).toEqual({ quantityOrdered: 48, unit: "kg", unitPrice: 12, notes: null });
    expect(costPerUnitLabel(flour)).toBe("£0.75/kg");
  });
  it("pack-counted lines still read and save the pack count", () => {
    const tins = { ...flour, unit: "packs", nativeUnit: "kg", packWeight: 2.5, editedPacks: 4 };
    expect(lineOrderQty(tins)).toBe("4 packs");
    expect(placedLineQuantity(tins).quantityOrdered).toBe(4);
    expect(costPerUnitLabel(tins)).toBe("£12.00/pack");
  });
  it("a native line that isn't whole packs reopens the old way", () => {
    expect(hydratePlacedLine({ quantityOrdered: 7, unit: "kg", isMisc: false, packWeight: 2.5 }))
      .toEqual({ unit: "kg", packs: 7, packWeight: 1, orderInPallets: false, palletSize: null });
    expect(hydratePlacedLine({ quantityOrdered: 7.5, unit: "kg", isMisc: false, packWeight: 2.5 }))
      .toEqual({ unit: "kg", packs: 3, packWeight: 2.5, orderInPallets: false, palletSize: null });
  });
});
