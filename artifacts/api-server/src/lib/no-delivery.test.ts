import { describe, it, expect } from "vitest";
import { isNoDeliveryOrder } from "./no-delivery";

describe("isNoDeliveryOrder", () => {
  it("only when every line is a No delivery item", () => {
    expect(isNoDeliveryOrder([{ ingredientId: 352, noDelivery: true }])).toBe(true);
    expect(isNoDeliveryOrder([{ ingredientId: 352, noDelivery: true }, { ingredientId: 7, noDelivery: false }])).toBe(false);
  });
  it("an empty order, or a one-off line with no item, still expects a delivery", () => {
    expect(isNoDeliveryOrder([])).toBe(false);
    expect(isNoDeliveryOrder([{ ingredientId: null, noDelivery: null }])).toBe(false);
    expect(isNoDeliveryOrder([{ ingredientId: 352, noDelivery: true }, { ingredientId: null, noDelivery: null }])).toBe(false);
  });
});
