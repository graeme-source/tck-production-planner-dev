import { describe, expect, it } from "vitest";
import { targetsProgressColour } from "./targets-progress-colour";
import { gradeKpi, kpiSpec } from "./numbers-benchmarks";

describe("Month to Date card: one colour (25 Nov 2026)", () => {
  it("bar is exactly the header's shade — £119,699 projected against £120k / £180k is not red because of £301", () => {
    const header = gradeKpi(119_699, { minimum: 120_000, stretch: 180_000 }, kpiSpec("monthlySales"), 1)!;
    const c = targetsProgressColour(119_699, 120_000, 180_000);
    expect(c.barHex).toBe(header.shade.hex);
  });

  it("status words use the shade only when it reads on white", () => {
    for (const projected of [60_000, 119_699, 150_000, 200_000]) {
      const header = gradeKpi(projected, { minimum: 120_000, stretch: 180_000 }, kpiSpec("monthlySales"), 1)!;
      const c = targetsProgressColour(projected, 120_000, 180_000);
      expect(c.textHex).toBe(header.shade.darkBackground ? header.shade.hex : null);
    }
  });

  it("with no stretch set: green on pace for the minimum, red behind", () => {
    expect(targetsProgressColour(130_000, 120_000, null).barHex).toBe("#7cb342");
    expect(targetsProgressColour(100_000, 120_000, null).barHex).toBe("#dc2626");
  });
});
