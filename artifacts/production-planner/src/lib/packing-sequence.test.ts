import { describe, it, expect } from "vitest";
import { packingStep, packingBlocker } from "./packing-sequence";

describe("the order of the packing morning", () => {
  it("orders to tag or book come first — booking tags them", () => {
    expect(packingStep({ toTag: 3, toBook: 0, dessertLabelsLeft: 0 })).toBe("book");
    expect(packingStep({ toTag: 0, toBook: 2, dessertLabelsLeft: 0 })).toBe("book");
  });
  it("then the dessert labels still needed", () => {
    expect(packingStep({ toTag: 0, toBook: 0, dessertLabelsLeft: 4 })).toBe("desserts");
    expect(packingStep({ toTag: 0, toBook: 0, dessertLabelsLeft: null })).toBe("desserts");
  });
  it("no desserts on the orders (or all printed) → straight to packing", () => {
    expect(packingStep({ toTag: 0, toBook: 0, dessertLabelsLeft: 0 })).toBe("ready");
  });
  it("a later despatch goes round again when new orders arrive", () => {
    expect(packingStep({ toTag: 1, toBook: 0, dessertLabelsLeft: 0 })).toBe("book");
  });
  it("says what's in the way, or nothing", () => {
    expect(packingBlocker("book", false)).toMatch(/book the APC labels/);
    expect(packingBlocker("desserts", true)).toMatch(/Checking/);
    expect(packingBlocker("desserts", false)).toMatch(/dessert labels first/);
    expect(packingBlocker("ready", false)).toBeNull();
  });
});
