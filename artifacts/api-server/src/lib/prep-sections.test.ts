import { describe, it, expect } from "vitest";
import { sectionTotalKg } from "./prep-sections";

describe("sectionTotalKg", () => {
  it("adds kilos straight", () => {
    // Flour + Breading Mix off the real sheet: 7.989 + 11.898 = 19.887.
    expect(sectionTotalKg([
      { unit: "kg", qty: 7.989 },
      { unit: "kg", qty: 11.898 },
    ])).toBe(19.887);
  });

  it("brings grams down to kilos", () => {
    // The Marinade Spice Mix is stored in grams per ingredient but is weighed
    // out as a bag — a total of 1700 g must not read as 1700 kg.
    expect(sectionTotalKg([
      { unit: "g", qty: 339.948 },
      { unit: "g", qty: 339.948 },
      { unit: "kg", qty: 0.17 },
    ])).toBe(0.85);
  });

  it("treats millilitres as grams", () => {
    expect(sectionTotalKg([{ unit: "ml", qty: 500 }])).toBe(0.5);
  });

  it("takes litres at face value, the way the paper sheet does", () => {
    // Tomato Ketchup is stocked in litres and lands in the Korean sauce
    // total alongside kilos. The sheet has always added them as one column;
    // converting would silently change a number the team checks against.
    expect(sectionTotalKg([
      { unit: "kg", qty: 10.186 },
      { unit: "l", qty: 3.565 },
    ])).toBe(13.751);
  });

  it("survives an empty step and rubbish quantities", () => {
    expect(sectionTotalKg([])).toBe(0);
    expect(sectionTotalKg([{ unit: "kg", qty: Number.NaN }])).toBe(0);
  });
});
