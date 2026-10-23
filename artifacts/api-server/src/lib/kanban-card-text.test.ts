import { describe, expect, it } from "vitest";
import { kanbanCardText, type KanbanCardSource } from "./kanban-card-text";

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
    expect(kanbanCardText({ ...base, kanbanUnit: "bottle", kanbanQuantity: 1 }).pullWhen).toBe("1 bottle");
    expect(kanbanCardText({ ...base, kanbanUnit: "pallet", kanbanOrderAmount: 2 }).orderAmount).toBe("2 pallets");
    expect(kanbanCardText({ ...base, kanbanUnit: "weight", kanbanQuantity: 2.5 }).pullWhen).toBe("2.5 kg");
    expect(kanbanCardText({ ...base, kanbanUnit: "packs", kanbanQuantity: 3 }).pullWhen).toBe("3 packs");
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
