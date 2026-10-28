import { describe, expect, it } from "vitest";
import { costPerKg, formatCostPerKg } from "./cost-per-kg";

describe("cost per kg", () => {
  it("weights in any unit come out per kg", () => {
    expect(costPerKg(6.07, 3, "kg")).toBeCloseTo(2.0233, 4);
    expect(costPerKg(1.5, 500, "g")).toBe(3);
    expect(costPerKg("4.80", "2", "KG")).toBe(2.4);
  });

  it("litres count as kilograms (density 1)", () => {
    expect(costPerKg(10, 5, "L")).toBe(2);
    expect(costPerKg(2, 250, "ml")).toBe(8);
  });

  it("count units, no cost or no size: not guessed", () => {
    expect(costPerKg(3, 12, "each")).toBeNull();
    expect(costPerKg(0, 1, "kg")).toBeNull();
    expect(costPerKg(5, 0, "kg")).toBeNull();
    expect(costPerKg(null, 1, "kg")).toBeNull();
  });

  it("formats with pence for very cheap items", () => {
    expect(formatCostPerKg(2.0233)).toBe("£2.02/kg");
    expect(formatCostPerKg(0.0456)).toBe("£0.0456/kg");
    expect(formatCostPerKg(null)).toBe("—");
  });
});
