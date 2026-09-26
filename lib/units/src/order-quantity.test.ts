import { describe, expect, it } from "vitest";
import {
  describePalletOrder,
  formatCount,
  formatPackSize,
  kanbanOrderPacks,
  packNoun,
  packsToBaseQty,
  palletPrice,
  palletReceiptLabel,
  palletsForPacks,
  unitWord,
} from "./order-quantity";

// Ice (Gel pack 500g), live 2026-09-26: unit each, 36 per box, £6.84 a box,
// 50 boxes a pallet, kanban = 1 pallet. The Orders page said "36 pallets".
const gelPack = { unit: "each", packWeight: 36, palletSize: 50, costPerPack: 6.84 };

describe("kanbanOrderPacks — a pallet is a real pallet", () => {
  it("1 pallet of 50-box pallets orders 50 packs (regression: was 1)", () => {
    expect(kanbanOrderPacks(1, "pallet", gelPack)).toEqual({ packs: 50, warning: null });
  });

  it("scales with the number of pallets, including part pallets", () => {
    expect(kanbanOrderPacks(2, "pallet", gelPack).packs).toBe(100);
    expect(kanbanOrderPacks(1.5, "pallet", gelPack).packs).toBe(75);
    expect(kanbanOrderPacks(1.1, "pallet", gelPack).packs).toBe(55); // no float over-round
  });

  it("flags a missing pallet size and falls back to one pack per pallet", () => {
    expect(kanbanOrderPacks(1, "pallet", { packWeight: 36, palletSize: null }))
      .toEqual({ packs: 1, warning: "pallet-size-missing" });
    expect(kanbanOrderPacks(2, "pallet", { packWeight: 36, palletSize: 0 }))
      .toEqual({ packs: 2, warning: "pallet-size-missing" });
  });

  it("weight kanbans are unchanged: base units ÷ pack weight, rounded up", () => {
    expect(kanbanOrderPacks(10, "weight", { packWeight: 2.5 })).toEqual({ packs: 4, warning: null });
    expect(kanbanOrderPacks(11, "weight", { packWeight: 2.5 }).packs).toBe(5);
    expect(kanbanOrderPacks(3, "weight", { packWeight: 0 }).packs).toBe(3);
  });

  it("pack and bottle kanbans count packs directly", () => {
    expect(kanbanOrderPacks(3, "pack", { packWeight: 5 }).packs).toBe(3);
    expect(kanbanOrderPacks(2, "bottle", { packWeight: 1 }).packs).toBe(2);
  });

  it("a missing amount orders one card's worth (1)", () => {
    expect(kanbanOrderPacks(null, "pack", { packWeight: 5 }).packs).toBe(1);
    expect(kanbanOrderPacks(null, "pallet", gelPack).packs).toBe(50);
  });
});

describe("pallet maths for the gel-pack line", () => {
  it("50 packs = 1,800 each, 1 pallet, £342.00", () => {
    expect(packsToBaseQty(50, gelPack.packWeight)).toBe(1800);
    expect(palletsForPacks(50, gelPack.palletSize)).toBe(1);
    expect(50 * gelPack.costPerPack).toBeCloseTo(342, 2);
    expect(palletPrice(gelPack.costPerPack, gelPack.palletSize)).toBe(342);
  });

  it("pack weight 0 counts each pack as 1 base unit (legacy maths)", () => {
    expect(packsToBaseQty(600, 0)).toBe(600);
  });
});

describe("describePalletOrder", () => {
  it("1 pallet reads '1 pallet', sub-line '50 packs · 1,800 each'", () => {
    const d = describePalletOrder(50, gelPack)!;
    expect(d.primary).toBe("1 pallet");
    expect(d.detail).toBe("50 packs · 1,800 each");
    expect(d.supplierText).toBe("1 pallet (50 × 36 each)");
  });

  it("typing 100 packs reads '2 pallets'", () => {
    expect(describePalletOrder(100, gelPack)!.primary).toBe("2 pallets");
  });

  it("a part pallet names the packs in the headline", () => {
    const d = describePalletOrder(75, gelPack)!;
    expect(d.primary).toBe("1.5 pallets (75 packs)");
    expect(d.detail).toBe("2,700 each");
    expect(d.supplierText).toBe("1.5 pallets (75 × 36 each)");
  });

  it("never says '36 pallets' for the gel pack", () => {
    const d = describePalletOrder(50, gelPack)!;
    for (const s of [d.primary, d.detail, d.supplierText]) expect(s).not.toContain("36 pallets");
  });

  it("returns null without a pallet size", () => {
    expect(describePalletOrder(1, { unit: "each", packWeight: 36, palletSize: null })).toBeNull();
  });

  it("uses the real unit for weights and litres", () => {
    expect(describePalletOrder(40, { unit: "kg", packWeight: 2.5, palletSize: 40 })!.supplierText)
      .toBe("1 pallet (40 × 2.5 kg)");
    expect(describePalletOrder(20, { unit: "l", packWeight: 5, palletSize: 20 })!.detail)
      .toBe("20 bottles · 100 L");
  });

  it("with no pack size, the supplier text quotes the base count", () => {
    expect(describePalletOrder(600, { unit: "each", packWeight: 0, palletSize: 600 })!.supplierText)
      .toBe("1 pallet (600 each)");
  });
});

describe("formatPackSize — the item's real unit, never a blanket kg", () => {
  it("each / L / kg / g / ml", () => {
    expect(formatPackSize(36, "each")).toBe("36 each");
    expect(formatPackSize(5, "l")).toBe("5 L");
    expect(formatPackSize(2.5, "kg")).toBe("2.5 kg");
    expect(formatPackSize(500, "g")).toBe("500g");
    expect(formatPackSize(330, "ml")).toBe("330ml");
    expect(formatPackSize(100, "pieces")).toBe("100 pieces");
  });
});

describe("unitWord / formatCount / packNoun", () => {
  it("pluralises known count nouns and leaves the rest alone", () => {
    expect(unitWord("each", 1800)).toBe("each");
    expect(unitWord("box", 3)).toBe("boxes");
    expect(unitWord("box", 1)).toBe("box");
    expect(unitWord("pieces", 1)).toBe("piece");
    expect(unitWord("roll", 2)).toBe("rolls");
    expect(unitWord("kg", 12.5)).toBe("kg");
    expect(unitWord("l", 5)).toBe("L");
    expect(unitWord("each (2.5kg)", 2)).toBe("each (2.5kg)");
  });

  it("formats counts for people", () => {
    expect(formatCount(1800)).toBe("1,800");
    expect(formatCount(1.5)).toBe("1.5");
    expect(formatCount(2.333)).toBe("2.33");
  });

  it("packNoun: bottles for liquids, packs otherwise", () => {
    expect(packNoun("each", 50)).toBe("packs");
    expect(packNoun("each", 1)).toBe("pack");
    expect(packNoun("l", 2)).toBe("bottles");
  });
});

describe("palletReceiptLabel — the receive screen", () => {
  it("a new gel-pack line (1,800 each) reads '1 pallet — 50 packs'", () => {
    expect(palletReceiptLabel(1800, "each", gelPack)).toBe("1 pallet — 50 packs");
  });

  it("a legacy '1 pallets' line reads the same", () => {
    expect(palletReceiptLabel(1, "pallets", gelPack)).toBe("1 pallet — 50 packs");
  });

  it("a pack-count line of 100 packs reads '2 pallets — 100 packs'", () => {
    expect(palletReceiptLabel(100, "packs", gelPack)).toBe("2 pallets — 100 packs");
  });

  it("stays quiet below one pallet, on part packs, or without a pallet size", () => {
    expect(palletReceiptLabel(36, "each", gelPack)).toBeNull();
    expect(palletReceiptLabel(1810, "each", gelPack)).toBeNull();
    expect(palletReceiptLabel(1800, "each", { ...gelPack, palletSize: null })).toBeNull();
  });
});
