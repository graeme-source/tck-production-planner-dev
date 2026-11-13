import { describe, expect, it } from "vitest";
import { packPriceTarget } from "./pack-price-target";

describe("packPriceTarget", () => {
  const ing = { supplierId: 27, secondarySupplierId: 5 };
  it("is the main price on the main supplier's card and the second price on the second's", () => {
    expect(packPriceTarget(ing, 27)).toBe("primary");
    expect(packPriceTarget(ing, 5)).toBe("secondary");
  });
  it("is nothing on a supplier the item was only dragged onto", () => {
    expect(packPriceTarget(ing, 9)).toBeNull();
    expect(packPriceTarget({ supplierId: null, secondarySupplierId: null }, 9)).toBeNull();
  });
});
