import { describe, expect, it } from "vitest";
import { prepTinTileLabel, recipeNameWithTinSize } from "./prep-tin-labels";

describe("recipeNameWithTinSize (left-hand Ingredients by Recipe list)", () => {
  it("puts the recipe's tin size in brackets after the name", () => {
    expect(recipeNameWithTinSize("Balsamic Roasted Vegetables", "XL")).toBe("Balsamic Roasted Vegetables (XL)");
    expect(recipeNameWithTinSize("Some Recipe", "XXL")).toBe("Some Recipe (XXL)");
  });

  it("shows just the name when no tin size is set", () => {
    expect(recipeNameWithTinSize("Some Recipe", null)).toBe("Some Recipe");
    expect(recipeNameWithTinSize("Some Recipe", undefined)).toBe("Some Recipe");
    expect(recipeNameWithTinSize("Some Recipe", "   ")).toBe("Some Recipe");
  });

  it("trims stray spaces around the tin size", () => {
    expect(recipeNameWithTinSize("Some Recipe", " L ")).toBe("Some Recipe (L)");
  });
});

describe("prepTinTileLabel (ingredient tin tiles)", () => {
  // Regression for fix-queue #323: every ingredient tile said "Tin 1 (XXL)",
  // which read as "this ingredient goes in its own XXL tin".
  it("never carries the tin size", () => {
    expect(prepTinTileLabel(1)).toBe("Tin 1");
    expect(prepTinTileLabel(3)).toBe("Tin 3");
  });
});
