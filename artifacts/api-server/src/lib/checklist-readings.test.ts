import { describe, it, expect } from "vitest";
import {
  normaliseReadingLabels, asksForReading, readingInRange, readingConfigProblem,
  readingsComplete, missingReadings, UNLABELLED,
} from "./checklist-readings";

describe("normaliseReadingLabels", () => {
  it("no labels means one unlabelled reading", () => {
    expect(normaliseReadingLabels(null)).toEqual([UNLABELLED]);
    expect(normaliseReadingLabels([])).toEqual([UNLABELLED]);
    expect(normaliseReadingLabels(["  ", ""])).toEqual([UNLABELLED]);
  });
  it("trims, drops blanks and case-insensitive duplicates, keeps order", () => {
    expect(normaliseReadingLabels([" Scale 1 ", "Scale  2", "scale 1", "", "Prep scale"]))
      .toEqual(["Scale 1", "Scale 2", "Prep scale"]);
  });
});

describe("asksForReading", () => {
  it("only when a unit is set", () => {
    expect(asksForReading(null)).toBe(false);
    expect(asksForReading("  ")).toBe(false);
    expect(asksForReading("g")).toBe(true);
  });
});

describe("readingInRange", () => {
  it("no range gives no verdict", () => {
    expect(readingInRange(1000, null, null)).toBeNull();
  });
  it("inclusive at both ends", () => {
    expect(readingInRange(999, 999, 1001)).toBe(true);
    expect(readingInRange(1001, 999, 1001)).toBe(true);
    expect(readingInRange(998.5, 999, 1001)).toBe(false);
    expect(readingInRange(1001.5, 999, 1001)).toBe(false);
  });
  it("one-sided ranges", () => {
    expect(readingInRange(3, null, 5)).toBe(true);
    expect(readingInRange(6, null, 5)).toBe(false);
    expect(readingInRange(0.5, 1, null)).toBe(false);
  });
});

describe("readingConfigProblem", () => {
  it("a plain tick is fine", () => {
    expect(readingConfigProblem({ unit: null, labels: null, min: null, max: null })).toBeNull();
  });
  it("labels or a range need a unit", () => {
    expect(readingConfigProblem({ unit: null, labels: ["Scale 1"], min: null, max: null })).toMatch(/unit/);
    expect(readingConfigProblem({ unit: "", labels: null, min: 1, max: null })).toMatch(/unit/);
  });
  it("min above max is refused", () => {
    expect(readingConfigProblem({ unit: "g", min: 1001, max: 999 })).toMatch(/above/);
  });
  it("a scale-calibration setup is fine", () => {
    expect(readingConfigProblem({ unit: "g", labels: ["Scale 1", "Scale 2"], min: 999, max: 1001 })).toBeNull();
  });
});

describe("readingsComplete / missingReadings", () => {
  it("every label needs a reading before the tick", () => {
    const labels = ["Scale 1", "Scale 2"];
    expect(readingsComplete(labels, ["Scale 1"])).toBe(false);
    expect(missingReadings(labels, ["Scale 1"])).toEqual(["Scale 2"]);
    expect(readingsComplete(labels, ["Scale 2", "Scale 1"])).toBe(true);
  });
  it("an unlabelled item needs its one reading", () => {
    expect(readingsComplete([UNLABELLED], [])).toBe(false);
    expect(readingsComplete([UNLABELLED], [UNLABELLED])).toBe(true);
  });
});
