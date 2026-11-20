// Issue #407: the Mozzarella Load card shows boxes as well as 2kg bags.
import { describe, expect, it } from "vitest";
import { bagsAsBoxes } from "./bag-boxes";

describe("bagsAsBoxes", () => {
  it("27 x 2kg bags from 12 kg boxes = 4 boxes + 3 bags", () => {
    expect(bagsAsBoxes(27, 2, 12, "kg", "box")).toEqual({ boxes: 4, looseBags: 3, bagsPerBox: 6, label: "4 boxes + 3 bags" });
  });
  it("exact boxes drop the bags part; singulars read right", () => {
    expect(bagsAsBoxes(30, 2, 12, "kg", "box")?.label).toBe("5 boxes");
    expect(bagsAsBoxes(7, 2, "12.0000", "kg", "box")?.label).toBe("1 box + 1 bag");
  });
  it("works when the ingredient is kept in grams", () => {
    expect(bagsAsBoxes(13, 2000, 12000, "g", "box")?.label).toBe("2 boxes + 1 bag");
  });
  it("follows the ingredient: a different box size or pack name changes the answer", () => {
    expect(bagsAsBoxes(27, 2, 10, "kg", "case")?.label).toBe("5 cases + 2 bags");
    expect(bagsAsBoxes(27, 2, 12, "kg", null)?.label).toBe("4 packs + 3 bags");
  });
  it("says nothing when it can't be sure: no pack weight, not whole bags per box, or under one box", () => {
    expect(bagsAsBoxes(27, 2, 0, "kg", "box")).toBeNull();
    expect(bagsAsBoxes(27, 2, null, "kg", "box")).toBeNull();
    expect(bagsAsBoxes(27, 2, 5, "kg", "box")).toBeNull();
    expect(bagsAsBoxes(27, 2, 2, "kg", "box")).toBeNull();
    expect(bagsAsBoxes(4, 2, 12, "kg", "box")).toBeNull();
    expect(bagsAsBoxes(0, 2, 12, "kg", "box")).toBeNull();
  });
});
