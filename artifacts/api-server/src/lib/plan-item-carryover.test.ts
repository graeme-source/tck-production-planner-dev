import { describe, expect, it } from "vitest";
import { carryOverItemFields } from "./plan-item-carryover";

describe("carryOverItemFields (27 Nov 2026 regression: queued bag wiped by Activate)", () => {
  it("keeps a recipe's 8-pack bags when the plan's recipes are saved again", () => {
    const old = [{ recipeId: 4 }, { recipeId: 5, eightPackBagCount: 1 }, { recipeId: 10 }];
    expect(carryOverItemFields(old, [10, 5, 4])).toEqual([{}, { eightPackBagCount: 1 }, {}]);
  });
  it("keeps freezer bags, the case order and a tin override; drops removed recipes", () => {
    const old = [{ recipeId: 7, freezerEightPackBagCount: 3, caseOrderId: 12, mixingTinOverride: 2 }, { recipeId: 8, eightPackBagCount: 2 }];
    expect(carryOverItemFields(old, [7, 9])).toEqual([{ freezerEightPackBagCount: 3, caseOrderId: 12, mixingTinOverride: 2 }, {}]);
  });
  it("a recipe twice takes the old rows in order", () => {
    const old = [{ recipeId: 5, eightPackBagCount: 1 }, { recipeId: 5, eightPackBagCount: 2 }];
    expect(carryOverItemFields(old, [5, 5, 5])).toEqual([{ eightPackBagCount: 1 }, { eightPackBagCount: 2 }, {}]);
  });
});
