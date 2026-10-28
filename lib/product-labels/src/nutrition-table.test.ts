import { describe, expect, it } from "vitest";
import { NUTRITION_TABLE_ROWS, formatNutrient, nutritionHeadings } from "./nutrition-table";

describe("nutrition table rounding (as on the website's nutrition images)", () => {
  it("energy is whole kJ / kcal with no space", () => {
    expect(formatNutrient("energyKj", 1004.4)).toBe("1004kJ");
    expect(formatNutrient("energyKcal", 239.6)).toBe("240kcal");
  });
  it("grams: 10 g or more whole, under 10 g one decimal, traces '<0.1g'", () => {
    expect(formatNutrient("fat", 12.4)).toBe("12g");
    expect(formatNutrient("saturates", 5.84)).toBe("5.8g");
    expect(formatNutrient("sugars", 4)).toBe("4.0g");
    expect(formatNutrient("sugars", 0.2)).toBe("0.2g");
    expect(formatNutrient("protein", 9.96)).toBe("10g");
    expect(formatNutrient("fibre", 0.03)).toBe("<0.1g");
    expect(formatNutrient("fat", 0)).toBe("0g");
  });
  it("salt: one decimal from 1 g, two below, traces '<0.01g'", () => {
    expect(formatNutrient("salt", 1.13)).toBe("1.1g");
    expect(formatNutrient("salt", 3.98)).toBe("4.0g");
    expect(formatNutrient("salt", 0.456)).toBe("0.46g");
    expect(formatNutrient("salt", 0.996)).toBe("1.0g");
    expect(formatNutrient("salt", 0.004)).toBe("<0.01g");
  });
  it("unknown values are a dash", () => {
    expect(formatNutrient("fat", null)).toBe("—");
    expect(formatNutrient("fat", Number.NaN)).toBe("—");
  });
  it("rows in the website's order, kcal under Energy, 'of which' indented, fibre optional", () => {
    expect(NUTRITION_TABLE_ROWS.map(r => r.key)).toEqual(["energyKj", "energyKcal", "fat", "saturates", "carbohydrate", "sugars", "fibre", "protein", "salt"]);
    expect(NUTRITION_TABLE_ROWS[1].label).toBe("");
    expect(NUTRITION_TABLE_ROWS.filter(r => r.indent).map(r => r.key)).toEqual(["saturates", "sugars"]);
    expect(NUTRITION_TABLE_ROWS.filter(r => r.optional).map(r => r.key)).toEqual(["fibre"]);
  });
  it("headings: per 100g, and per <portion>g serving on two lines", () => {
    expect(nutritionHeadings(355.2)).toEqual({ per100g: "per 100g", perPortion: ["per 355g", "serving"] });
    expect(nutritionHeadings(null).perPortion).toBeNull();
  });
});
