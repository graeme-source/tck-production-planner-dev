import { describe, expect, it } from "vitest";
import { usedInLabel } from "./used-in-label";

describe("usedInLabel", () => {
  it("says how many recipes and sub-recipes, singular or plural", () => {
    expect(usedInLabel(3, 0)).toBe("3 recipes");
    expect(usedInLabel(1, 0)).toBe("1 recipe");
    expect(usedInLabel(2, 1)).toBe("2 recipes + 1 sub-recipe");
    expect(usedInLabel(0, 2)).toBe("2 sub-recipes");
  });
});
