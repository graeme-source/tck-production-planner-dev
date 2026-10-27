import { describe, expect, it } from "vitest";
import {
  deferredPrepGroupKey, deferredPrepItemOf, groupDeferredPrep, type DeferredPrepItem,
} from "./deferred-prep-groups";

let nextId = 1;
function tin(over: Partial<DeferredPrepItem>): DeferredPrepItem {
  return {
    id: nextId++,
    sourcePlanId: 10,
    sourcePlanDate: "2026-10-24",
    sourcePlanName: null,
    ingredientId: 5,
    isSubRecipe: false,
    subRecipeOriginId: null,
    recipeId: 3,
    recipeName: "Pepperoni",
    recipeCategory: null,
    recipeColor: null,
    tinNumber: 1,
    tinCount: 3,
    qtyPerTin: 1200,
    deferredToDate: "2026-10-27",
    deferredAt: "2026-10-24T14:00:00Z",
    deferredByUserId: null,
    deferredByUserName: null,
    itemName: "Mozzarella",
    itemUnit: "g",
    ...over,
  };
}

describe("groupDeferredPrep", () => {
  it("puts one item's tins for one recipe on one card, in tin order", () => {
    const groups = groupDeferredPrep([tin({ tinNumber: 3 }), tin({ tinNumber: 1 }), tin({ tinNumber: 2 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tins.map(t => t.tinNumber)).toEqual([1, 2, 3]);
    expect(groups[0].itemName).toBe("Mozzarella");
    expect(groups[0].recipeName).toBe("Pepperoni");
  });

  it("never mixes two source prep days on one card (ticks and timing go to that plan)", () => {
    const groups = groupDeferredPrep([
      tin({ sourcePlanId: 10, tinNumber: 1 }),
      tin({ sourcePlanId: 11, sourcePlanDate: "2026-10-25", tinNumber: 1 }),
    ]);
    expect(groups.map(g => g.sourcePlanId)).toEqual([10, 11]);
  });

  it("keeps recipes, sub-recipes and origin-tagged ingredients apart", () => {
    const groups = groupDeferredPrep([
      tin({}),
      tin({ recipeId: 4 }),
      tin({ isSubRecipe: true }),
      tin({ subRecipeOriginId: 7 }),
    ]);
    expect(groups).toHaveLength(4);
    expect(new Set(groups.map(g => g.key)).size).toBe(4);
  });

  it("keeps the server's order of cards", () => {
    const groups = groupDeferredPrep([
      tin({ ingredientId: 9, itemName: "Basil" }),
      tin({ ingredientId: 5 }),
      tin({ ingredientId: 9, itemName: "Basil", tinNumber: 2 }),
    ]);
    expect(groups.map(g => g.itemName)).toEqual(["Basil", "Mozzarella"]);
    expect(groups[0].tins).toHaveLength(2);
  });

  it("names missing names plainly", () => {
    const [group] = groupDeferredPrep([tin({ itemName: null, recipeName: null })]);
    expect(group.itemName).toBe("Item");
    expect(group.recipeName).toBe("Recipe");
  });

  it("returns no cards for no tins", () => {
    expect(groupDeferredPrep([])).toEqual([]);
  });
});

describe("deferredPrepGroupKey", () => {
  it("is the same for two tins of the same card", () => {
    expect(deferredPrepGroupKey(tin({ tinNumber: 1 }))).toBe(deferredPrepGroupKey(tin({ tinNumber: 2 })));
  });
});

describe("deferredPrepItemOf", () => {
  it("times an ingredient as the ingredient and a sub-recipe as the sub-recipe", () => {
    expect(deferredPrepItemOf({ ingredientId: 5, isSubRecipe: false })).toEqual({ ingredientId: 5 });
    expect(deferredPrepItemOf({ ingredientId: 8, isSubRecipe: true })).toEqual({ subRecipeId: 8 });
  });
});
