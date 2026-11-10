import { describe, it, expect } from "vitest";
import { combineBlocker, planLineMerge, type CombineLine } from "./order-combine-rules";

const order = (over: Partial<Parameters<typeof combineBlocker>[0]> = {}) => ({
  id: 769, supplierId: 5, status: "placed", expectedDeliveryDate: "2026-11-09", ...over,
});
const line = (over: Partial<CombineLine> = {}): CombineLine => ({
  ingredientId: 1, description: null, quantityRequired: "2", quantityOrdered: "2", quantityReceived: "0",
  unit: "kg", unitPrice: "1.5000", checkedOff: true, goodsInChecked: false, notes: null, ...over,
});

describe("combineBlocker", () => {
  it("allows two placed orders, same supplier, same day", () => {
    expect(combineBlocker(order(), order({ id: 770 }), false)).toBeNull();
  });
  it("refuses a different day, supplier or status", () => {
    expect(combineBlocker(order(), order({ id: 770, expectedDeliveryDate: "2026-11-10" }), false)).toMatch(/different delivery days/);
    expect(combineBlocker(order(), order({ id: 770, supplierId: 6 }), false)).toMatch(/different suppliers/);
    expect(combineBlocker(order(), order({ id: 770, status: "received" }), false)).toMatch(/haven't been received/);
  });
  it("refuses once receiving has started, and an order with itself", () => {
    expect(combineBlocker(order(), order({ id: 770 }), true)).toMatch(/already started/);
    expect(combineBlocker(order(), order(), false)).toMatch(/same order/);
  });
});

describe("planLineMerge", () => {
  it("adds the same item up and moves everything else across", () => {
    const basil = line({ ingredientId: 1, quantityOrdered: "0.3", quantityRequired: "0.3" });
    const moreBasil = line({ ingredientId: 1, quantityOrdered: "0.1", quantityRequired: "0.2" });
    const onions = line({ ingredientId: 2 });
    const plan = planLineMerge([basil], [moreBasil, onions]);
    expect(plan.add).toEqual([{ line: basil, quantityRequired: "0.5", quantityOrdered: "0.4", checkedOff: true }]);
    expect(plan.move).toEqual([onions]);
  });
  it("adds up three lines of one item onto one target line", () => {
    const target = line();
    const plan = planLineMerge([target], [line(), line()]);
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0].quantityOrdered).toBe("6");
  });
  it("keeps lines apart when the unit or price differs, or a line has notes", () => {
    const target = line();
    const differing = [line({ unit: "g" }), line({ unitPrice: "2" }), line({ notes: "1 pallet (50 × 36 each)" })];
    const plan = planLineMerge([target], differing);
    expect(plan.add).toEqual([]);
    expect(plan.move).toEqual(differing);
  });
  it("matches one-off lines by name, ignoring case", () => {
    const target = line({ ingredientId: null, description: "Sample box" });
    const plan = planLineMerge([target], [line({ ingredientId: null, description: "sample box " })]);
    expect(plan.add).toHaveLength(1);
    const other = planLineMerge([target], [line({ ingredientId: null, description: "Other" })]);
    expect(other.move).toHaveLength(1);
  });
});
