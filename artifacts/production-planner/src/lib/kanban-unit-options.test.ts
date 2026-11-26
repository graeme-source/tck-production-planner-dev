import { describe, expect, it } from "vitest";
import { kanbanAmountWord, kanbanUnitOptions, unitWord } from "./kanban-unit-options";

describe("kanbanUnitOptions", () => {
  it("offers the item's own unit first, and packs with their size", () => {
    const o = kanbanUnitOptions({ unit: "pieces", packWeight: 10000, current: "unit" });
    expect(o.map(x => x.value)).toEqual(["unit", "pack", "bottle", "pallet"]);
    expect(o[0]!.label).toBe("Pieces — this item's own unit");
    expect(o[1]!.label).toBe("Packs (10,000 pieces each)");
  });
  it("keeps the old Weight setting only on items that have it", () => {
    expect(kanbanUnitOptions({ unit: "kg", packWeight: 10, current: "weight" })[0]!.value).toBe("weight");
    expect(kanbanUnitOptions({ unit: "kg", packWeight: 10, current: "pack" }).some(x => x.value === "weight")).toBe(false);
  });
  it("names weights and volumes plainly", () => {
    expect(kanbanUnitOptions({ unit: "kg", packWeight: null, current: "unit" })[0]!.label).toBe("kg — this item's own unit");
    expect(unitWord("l")).toBe("litres");
  });
});

describe("kanbanAmountWord", () => {
  it("says what the trigger and order numbers count", () => {
    expect(kanbanAmountWord("unit", "pieces")).toBe("pieces");
    expect(kanbanAmountWord("pack", "pieces")).toBe("packs");
    expect(kanbanAmountWord("pallet", "kg")).toBe("pallets");
    expect(kanbanAmountWord("weight", "kg")).toBeNull();
  });
});

describe("a named pack (pepperoni boxes, 26 Nov 2026)", () => {
  it("says boxes, not packs", () => {
    expect(kanbanAmountWord("pack", "kg", "box")).toBe("boxes");
    expect(kanbanUnitOptions({ unit: "kg", packWeight: 10, current: "pack", packName: "box" }).find(o => o.value === "pack")!.label).toBe("Boxes (10 kg each)");
  });
});

