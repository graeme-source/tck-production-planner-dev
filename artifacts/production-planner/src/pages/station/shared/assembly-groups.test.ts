import { describe, it, expect } from "vitest";
import { splitToppings, isToppingEntry, formatGrams, toppingQuantities } from "./assembly-groups";

const inside = (name: string) => ({ key: name, isFilling: false, ai: { isTopping: false } });
const top = (name: string) => ({ key: name, isFilling: false, ai: { isTopping: true } });
const filling = { key: "filling", isFilling: true };

describe("splitToppings", () => {
  // Regression: the "On top" section only appeared when toppings were the
  // last rows. A topping sorted before an inside item (no saved order →
  // alphabetical, or BBQ Pulled Pork's two Rosemary lines sharing one saved
  // order) made the section disappear.
  it("puts a topping in the On top group even when it sorts before inside items", () => {
    const { inside: ins, onTop } = splitToppings([filling, top("Cracked Black Pepper"), inside("Mozzarella")]);
    expect(ins.map(e => e.key)).toEqual(["filling", "Mozzarella"]);
    expect(onTop.map(e => e.key)).toEqual(["Cracked Black Pepper"]);
  });

  it("separates the same ingredient used inside and on top (BBQ Pulled Pork rosemary)", () => {
    const rosemaryTop = { key: "ingredient-19-1", isFilling: false, ai: { isTopping: true } };
    const rosemaryIn = { key: "ingredient-19-2", isFilling: false, ai: { isTopping: false } };
    const { inside: ins, onTop } = splitToppings([filling, inside("Mozzarella"), rosemaryTop, rosemaryIn]);
    expect(ins.map(e => e.key)).toEqual(["filling", "Mozzarella", "ingredient-19-2"]);
    expect(onTop.map(e => e.key)).toEqual(["ingredient-19-1"]);
  });

  it("keeps saved order within each group and handles no toppings", () => {
    expect(splitToppings([inside("a"), filling, inside("b")]).onTop).toEqual([]);
    expect(splitToppings([top("x"), inside("a"), top("y")]).onTop.map(e => e.key)).toEqual(["x", "y"]);
  });

  it("never treats the filling as a topping", () => {
    expect(isToppingEntry({ isFilling: true, ai: { isTopping: true } })).toBe(false);
  });
});

describe("toppingQuantities", () => {
  it("shows the amount on each item and per batch", () => {
    // 0.2 g rosemary per calzone, 10 per batch → 2 g per batch.
    expect(toppingQuantities(2, 10)).toEqual({ perItem: "0.2 g", perBatch: "2 g" });
    expect(toppingQuantities(3, 10)).toEqual({ perItem: "0.3 g", perBatch: "3 g" });
  });

  it("guards against a missing portions-per-batch", () => {
    expect(toppingQuantities(2, 0)).toEqual({ perItem: "2 g", perBatch: "2 g" });
  });
});

describe("formatGrams", () => {
  it("keeps decimals for small amounts, rounds big ones", () => {
    expect(formatGrams(0.25)).toBe("0.25 g");
    expect(formatGrams(2.5)).toBe("2.5 g");
    expect(formatGrams(750.4)).toBe("750 g");
    expect(formatGrams(0)).toBe("0 g");
  });
});
