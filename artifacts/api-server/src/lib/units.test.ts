import { describe, expect, it } from "vitest";
import { toGrams } from "./units";

// Regression guard for the nutritionals bug where every recipe quantity was
// treated as grams: a 1.2 kg ingredient contributed 1.2 g to the label maths,
// understating its nutrients ~1000x.
describe("toGrams", () => {
  it("converts kg to grams", () => {
    expect(toGrams(1.2, "kg")).toBe(1200);
  });

  it("converts litres to grams at density 1", () => {
    expect(toGrams(0.5, "l")).toBe(500);
    expect(toGrams(2, "Litres")).toBe(2000);
  });

  it("passes grams and millilitres through", () => {
    expect(toGrams(250, "g")).toBe(250);
    expect(toGrams(250, "ml")).toBe(250);
  });

  it("treats unknown or missing units as grams", () => {
    expect(toGrams(3, "each")).toBe(3);
    expect(toGrams(3, null)).toBe(3);
    expect(toGrams(3, undefined)).toBe(3);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(toGrams(1, " KG ")).toBe(1000);
  });
});
