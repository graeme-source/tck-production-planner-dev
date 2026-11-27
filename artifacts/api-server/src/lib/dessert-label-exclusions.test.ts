import { describe, it, expect } from "vitest";
import { parseExcludedOrderIds, withoutExcluded } from "./dessert-label-exclusions";

describe("dessert labels leave out orders without an APC label (27 Nov 2026)", () => {
  it("reads ids from a query string or a body, ignoring junk", () => {
    expect([...parseExcludedOrderIds("12, 34,,x,-5")]).toEqual([12, 34]);
    expect([...parseExcludedOrderIds([7, "8", 0, null])]).toEqual([7, 8]);
    expect(parseExcludedOrderIds(undefined).size).toBe(0);
  });
  it("drops the issue orders and keeps the booked ones", () => {
    const orders = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(withoutExcluded(orders, new Set([2])).map(o => o.id)).toEqual([1, 3]);
    expect(withoutExcluded(orders, new Set())).toBe(orders);
  });
});
