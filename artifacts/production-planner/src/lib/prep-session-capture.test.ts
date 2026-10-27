import { describe, it, expect } from "vitest";
import {
  DEVICE_ID_KEY, cleanQuantity, deviceIdFrom, focusChanges, prepItemBaseKey, prepItemKey,
} from "./prep-session-capture";

describe("prepItemKey", () => {
  it("keys an ingredient, a sub-recipe and a recipe-scoped item", () => {
    expect(prepItemKey({ ingredientId: 12 })).toBe("ing:12");
    expect(prepItemKey({ subRecipeId: 5 })).toBe("sub:5");
    expect(prepItemKey({ ingredientId: 12, recipeId: 3 })).toBe("ing:12@r:3");
    expect(prepItemBaseKey({ ingredientId: 12, recipeId: 3 })).toBe("ing:12");
  });
  it("is null unless it is exactly one item", () => {
    expect(prepItemKey({})).toBeNull();
    expect(prepItemKey({ ingredientId: 1, subRecipeId: 2 })).toBeNull();
  });
});

describe("focusChanges", () => {
  it("opens what is newly on screen and closes what has gone", () => {
    expect(focusChanges(["ing:1", "ing:2"], [{ ingredientId: 2 }, { subRecipeId: 9 }])).toEqual({
      close: ["ing:1"],
      open: [{ key: "sub:9", item: { subRecipeId: 9 } }],
    });
  });
  it("does nothing when the same item is shown again (a poll re-render)", () => {
    expect(focusChanges(["ing:2"], [{ ingredientId: 2 }])).toEqual({ close: [], open: [] });
  });
  it("closes everything when nothing is on screen", () => {
    expect(focusChanges(["ing:2", "sub:9"], [])).toEqual({ close: ["ing:2", "sub:9"], open: [] });
  });
  it("treats the same meat in two recipes as two items, and ignores duplicates and junk", () => {
    const r = focusChanges([], [
      { ingredientId: 7, recipeId: 1 }, { ingredientId: 7, recipeId: 2 }, { ingredientId: 7, recipeId: 1 }, {},
    ]);
    expect(r.open.map(o => o.key)).toEqual(["ing:7@r:1", "ing:7@r:2"]);
  });
});

describe("cleanQuantity", () => {
  it("keeps sensible amounts, rounded", () => {
    expect(cleanQuantity(0.88)).toBe(0.88);
    expect(cleanQuantity(1 / 3)).toBe(0.3333);
    expect(cleanQuantity(0)).toBe(0);
  });
  it("drops what the server would refuse", () => {
    expect(cleanQuantity(null)).toBeNull();
    expect(cleanQuantity(Number.NaN)).toBeNull();
    expect(cleanQuantity(-1)).toBeNull();
    expect(cleanQuantity(2_000_000)).toBeNull();
  });
});

describe("deviceIdFrom", () => {
  function memory() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
  }
  it("makes an id once and then keeps it", () => {
    const s = memory();
    let n = 0;
    const make = () => `id-${++n}`;
    expect(deviceIdFrom(s, make)).toBe("id-1");
    expect(deviceIdFrom(s, make)).toBe("id-1");
    expect(s.m.get(DEVICE_ID_KEY)).toBe("id-1");
  });
  it("gives no id when storage is missing or throws", () => {
    expect(deviceIdFrom(null, () => "x")).toBeNull();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => undefined };
    expect(deviceIdFrom(broken, () => "x")).toBeNull();
  });
});
