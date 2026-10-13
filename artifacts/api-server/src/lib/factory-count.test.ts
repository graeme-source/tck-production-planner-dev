import { describe, it, expect } from "vitest";
import { expectedCountProducts, factoryCountStatus } from "./factory-count";

const a = { recipeId: 1, name: "Alpha" };
const b = { recipeId: 2, name: "Bravo" };
const c = { recipeId: 3, name: "Charlie" };

describe("expectedCountProducts", () => {
  it("is core menu plus anything holding fridge stock, once each", () => {
    expect(expectedCountProducts([b, a], [a, c]).map(p => p.recipeId)).toEqual([1, 2, 3]);
  });
});

describe("factoryCountStatus", () => {
  it("counts what is still missing from today's count", () => {
    const s = factoryCountStatus([a, b, c], [2]);
    expect(s).toMatchObject({ expected: 3, counted: 1, outstanding: 2, complete: false });
    expect(s.missing.map(p => p.name)).toEqual(["Alpha", "Charlie"]);
  });

  it("is complete once every product has a count today", () => {
    expect(factoryCountStatus([a, b], [1, 2, 99])).toMatchObject({ outstanding: 0, complete: true });
  });

  it("is complete when there is nothing to count", () => {
    expect(factoryCountStatus([], [])).toMatchObject({ expected: 0, complete: true });
  });
});
