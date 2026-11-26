import { describe, it, expect } from "vitest";
import { itemsToPacks, kanbanOrderItemsText, kanbanPullItemsText, kanbanSingleItems, packsToItems } from "./kanban-single-items";

const pepperoni = { kanbanUnit: "pack", kanbanItemName: "bag", kanbanItemsPerPack: 10 };

describe("kanban in single items", () => {
  it("is on only for a pack kanban with a name and at least 2 per pack", () => {
    expect(kanbanSingleItems(pepperoni)).toEqual({ name: "bag", perPack: 10 });
    expect(kanbanSingleItems({ ...pepperoni, kanbanUnit: "pallet" })).toBeNull();
    expect(kanbanSingleItems({ ...pepperoni, kanbanUnit: "unit" })).toBeNull();
    expect(kanbanSingleItems({ ...pepperoni, kanbanItemsPerPack: null })).toBeNull();
    expect(kanbanSingleItems({ ...pepperoni, kanbanItemsPerPack: 1 })).toBeNull();
    expect(kanbanSingleItems({ ...pepperoni, kanbanItemName: "thing" })).toBeNull();
  });

  it("reads the stored packs as bags and stores typed bags as packs", () => {
    const s = kanbanSingleItems(pepperoni)!;
    expect(kanbanPullItemsText(1.5, s)).toBe("15 bags");
    expect(kanbanPullItemsText(0.1, s)).toBe("1 bag");
    expect(itemsToPacks(15, s)).toBe(1.5);
    // A third of a box survives the 4-decimal column and reads back whole.
    const twelve = { name: "bag" as const, perPack: 12 };
    expect(packsToItems(itemsToPacks(7, twelve), twelve)).toBe(7);
  });

  it("orders in boxes and says how many bags they bring", () => {
    const s = kanbanSingleItems(pepperoni)!;
    expect(kanbanOrderItemsText(3, s, "box")).toBe("3 boxes (30 bags)");
    expect(kanbanOrderItemsText(1, s, "box")).toBe("1 box (10 bags)");
    expect(kanbanOrderItemsText(2, s, null)).toBe("2 packs (20 bags)");
  });
});
