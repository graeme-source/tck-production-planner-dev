import { describe, expect, it } from "vitest";
import { quantityLabel, uncoveredIngredients, uncoveredReason, withNotOrdered, withoutNotOrdered, type PlanIngredientNeed } from "./uncovered-ingredients-rules";

const need = (over: Partial<PlanIngredientNeed> = {}): PlanIngredientNeed => ({
  ingredientId: 1, name: "Chestnut Mushrooms", unit: "g", totalRequired: 10500,
  stockCheckEnabled: false, kanbanEnabled: false, hasPulledKanban: false, supplierId: 7, supplierName: "AB Fruits", ...over,
});
const none = new Set<number>();

describe("the chestnut mushrooms (regression: 23 Nov 2026)", () => {
  // 17 batches of the new beef and mushroom recipe needed 10.5 kg. Stock
  // check was off and there was no kanban, so the orders page never listed it.
  it("names an ingredient the plan needs that has no kanban and no stock check, with how much", () => {
    expect(uncoveredIngredients([need()], none).uncovered).toEqual([{
      ingredientId: 1, name: "Chestnut Mushrooms", reason: "no_kanban_no_stock_check", requiredLabel: "10.5 kg", supplierName: "AB Fruits",
    }]);
  });
});

describe("uncoveredReason", () => {
  it("is covered once the stock check is on", () => {
    expect(uncoveredReason(need({ stockCheckEnabled: true }))).toBeNull();
  });
  it("is covered by a kanban, whether or not its card has been scanned", () => {
    expect(uncoveredReason(need({ kanbanEnabled: true }))).toBeNull();
    expect(uncoveredReason(need({ hasPulledKanban: true }))).toBeNull();
  });
  it("still can't be ordered when it has no supplier", () => {
    expect(uncoveredReason(need({ stockCheckEnabled: true, supplierId: null, supplierName: null }))).toBe("no_supplier");
  });
  it("says no kanban and no stock check first when both are wrong", () => {
    expect(uncoveredReason(need({ supplierId: null }))).toBe("no_kanban_no_stock_check");
  });
});

describe("uncoveredIngredients", () => {
  it("ignores ingredients the plan doesn't use", () => {
    expect(uncoveredIngredients([need({ totalRequired: 0 })], none).uncovered).toEqual([]);
  });
  it("keeps the ones a manager marked as never ordered off the warning, and lists them apart", () => {
    const water = need({ ingredientId: 2, name: "Water", unit: "ml", totalRequired: 40000, supplierId: null, supplierName: null });
    const result = uncoveredIngredients([need(), water], new Set([2]));
    expect(result.uncovered.map(i => i.name)).toEqual(["Chestnut Mushrooms"]);
    expect(result.notOrdered.map(i => i.name)).toEqual(["Water"]);
  });
  it("lists them by name", () => {
    const result = uncoveredIngredients([need({ ingredientId: 3, name: "Thyme" }), need()], none);
    expect(result.uncovered.map(i => i.name)).toEqual(["Chestnut Mushrooms", "Thyme"]);
  });
});

describe("quantityLabel", () => {
  it("says kilos and litres for big amounts", () => {
    expect(quantityLabel(10500, "g")).toBe("10.5 kg");
    expect(quantityLabel(1000, "g")).toBe("1 kg");
    expect(quantityLabel(2250, "ml")).toBe("2.25 L");
  });
  it("leaves small amounts and other units alone", () => {
    expect(quantityLabel(250, "g")).toBe("250 g");
    expect(quantityLabel(12.345, "g")).toBe("12.3 g");
    expect(quantityLabel(3, "each")).toBe("3 each");
    expect(quantityLabel(4.5, "kg")).toBe("4.5 kg");
  });
});

describe("the never-ordered list", () => {
  const water = { id: 2, name: "Water", by: "Kerri", at: "2026-11-23T10:00:00Z" };
  it("holds one entry per ingredient, and one can be put back", () => {
    const again = { ...water, by: "Graeme" };
    expect(withNotOrdered([water], again)).toEqual([again]);
    expect(withoutNotOrdered([water], 2)).toEqual([]);
    expect(withoutNotOrdered([water], 9)).toEqual([water]);
  });
});
