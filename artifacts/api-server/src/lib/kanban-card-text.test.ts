import { describe, expect, it } from "vitest";
import { kanbanCardText, kanbanOrderUnitLabel, kanbanLocationLabel, kanbanLocationsLabel, type KanbanCardSource } from "./kanban-card-text";

const base: KanbanCardSource = {
  id: 1, name: " Example item ", unit: "kg", kanbanQuantity: 1, kanbanUnit: "pack", kanbanOrderAmount: 4,
  supplier: "Example Supplier", supplierPartNumber: " EX-1 ", location: "Dry store", packName: null,
};

describe("kanbanCardText", () => {
  it("reads in the kanban unit, not the stock unit", () => {
    const t = kanbanCardText(base);
    expect(t.pullWhen).toBe("1 pack");
    expect(t.orderAmount).toBe("4 packs");
    expect(t.name).toBe("Example item");
    expect(t.partNumber).toBe("EX-1");
  });

  it("uses a named pack, bottles, pallets and the native unit for weight", () => {
    expect(kanbanCardText({ ...base, packName: "box", kanbanOrderAmount: 2 }).orderAmount).toBe("2 boxes");
    // The item's own unit: "Pull at 1000 pieces, order 10000 pieces"
    const own = kanbanCardText({ ...base, unit: "pieces", kanbanUnit: "unit", kanbanQuantity: 1000, kanbanOrderAmount: 10000 });
    expect([own.pullWhen, own.orderAmount]).toEqual(["1000 pieces", "10000 pieces"]);
    expect(kanbanCardText({ ...base, kanbanUnit: "bottle", kanbanQuantity: 1 }).pullWhen).toBe("1 bottle");
    expect(kanbanCardText({ ...base, kanbanUnit: "pallet", kanbanOrderAmount: 2 }).orderAmount).toBe("2 pallets");
    expect(kanbanCardText({ ...base, kanbanUnit: "weight", kanbanQuantity: 2.5 }).pullWhen).toBe("2.5 kg");
    expect(kanbanCardText({ ...base, kanbanUnit: "packs", kanbanQuantity: 3 }).pullWhen).toBe("3 packs");
  });

  it("counts single items on the card but orders whole packs (pepperoni, 26 Nov 2026)", () => {
    const pepperoni = { ...base, packName: "box", kanbanQuantity: 1.5, kanbanOrderAmount: 3, kanbanItemName: "bag", kanbanItemsPerPack: 10 };
    const t = kanbanCardText(pepperoni);
    expect(t.pullWhen).toBe("15 bags");
    expect(t.orderAmount).toBe("3 boxes (30 bags)");
    // Off, or on a kanban that doesn't count packs: unchanged.
    expect(kanbanCardText({ ...pepperoni, kanbanItemsPerPack: null }).pullWhen).toBe("1.5 boxes");
    expect(kanbanCardText({ ...pepperoni, kanbanUnit: "pallet" }).pullWhen).toBe("1.5 pallets");
  });

  it("says Not set / Not assigned instead of leaving gaps", () => {
    const t = kanbanCardText({ ...base, kanbanQuantity: 0, kanbanOrderAmount: null, supplier: null, location: "  ", supplierPartNumber: null });
    expect(t.pullWhen).toBe("Not set");
    expect(t.orderAmount).toBe("Not set");
    expect(t.supplier).toBe("Not assigned");
    expect(t.location).toBe("Not assigned");
    expect(t.partNumber).toBeNull();
  });
});

describe("kanbanLocationLabel (#357 — rack and shelf print on the card)", () => {
  const loc = (rackLabel: string | null, shelfLabel: string | null) => ({ name: " Dry Store ", rackLabel, shelfLabel });

  it("prints the location name, then rack, then shelf", () => {
    expect(kanbanLocationLabel(loc("A1", "Top"))).toBe("Dry Store · Rack A1 · Top shelf");
  });

  it("drops blank rack or shelf instead of leaving gaps", () => {
    expect(kanbanLocationLabel(loc(null, null))).toBe("Dry Store");
    expect(kanbanLocationLabel(loc("  ", "Bottom"))).toBe("Dry Store · Bottom shelf");
    expect(kanbanLocationLabel(loc("B2", ""))).toBe("Dry Store · Rack B2");
  });

  it("doesn't double up words the team already typed, and reads codes as Shelf N", () => {
    expect(kanbanLocationLabel(loc("Rack 4", "Top shelf"))).toBe("Dry Store · Rack 4 · Top shelf");
    expect(kanbanLocationLabel(loc("A1", "3"))).toBe("Dry Store · Rack A1 · Shelf 3");
  });

  it("joins several assignments, and is null when there are none", () => {
    expect(kanbanLocationsLabel([loc("A1", null), { name: "Walk-in", rackLabel: null, shelfLabel: null }])).toBe("Dry Store · Rack A1, Walk-in");
    expect(kanbanLocationsLabel([])).toBeNull();
  });
});

describe("kanbanOrderUnitLabel (the words after the quantity when a card is scanned)", () => {
  const ing = { kanbanUnit: "pack", unit: "kg", packName: "box", packWeight: "10.0000" };
  it("names the pack and says what it adds up to", () => {
    expect(kanbanOrderUnitLabel(3, ing)).toBe("boxes (30 kg)");
    expect(kanbanOrderUnitLabel(1, ing)).toBe("box (10 kg)");
    expect(kanbanOrderUnitLabel(3, { ...ing, kanbanItemName: "bag", kanbanItemsPerPack: 10 })).toBe("boxes (30 bags, 30 kg)");
    expect(kanbanOrderUnitLabel(2, { ...ing, packName: null, packWeight: 1 })).toBe("packs");
  });
  it("leaves bottles, pallets and the item's own unit as they were", () => {
    expect(kanbanOrderUnitLabel(2, { ...ing, kanbanUnit: "pallet" })).toBe("pallets");
    expect(kanbanOrderUnitLabel(500, { ...ing, kanbanUnit: "unit", unit: "pieces" })).toBe("pieces");
    expect(kanbanOrderUnitLabel(1, { ...ing, kanbanUnit: "bottle" })).toBe("bottle");
  });
});
