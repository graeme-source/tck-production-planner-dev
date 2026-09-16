import { describe, it, expect } from "vitest";
import { builtPortionWeightG, builtPackTargetWeightG } from "./built-portion-weight";

describe("builtPortionWeightG", () => {
  it("matches the Philly Cheesesteak numbers that motivated the change", () => {
    // Live recipe 26: filling 97g/portion × 10, mozzarella 60g + nacho 30g
    // per portion, dough 115g/portion, no builder trim. The builders place
    // 302g per portion — the old raw-sum basis said ~361g.
    const w = builtPortionWeightG({
      fillingGramsPerBatch: 970,
      builderFillingDeductionGrams: 0,
      assemblyGramsPerBatch: 900, // (60 + 30) × 10
      doughGramsPerPortion: 115,
      portionsPerBatch: 10,
    });
    expect(w).toBe(302);
  });

  it("applies the builder's per-batch trim to the filling", () => {
    const w = builtPortionWeightG({
      fillingGramsPerBatch: 1000,
      builderFillingDeductionGrams: 100,
      assemblyGramsPerBatch: 0,
      doughGramsPerPortion: 100,
      portionsPerBatch: 10,
    });
    expect(w).toBe(190); // (1000 − 100)/10 + 100
  });

  it("never lets a trim larger than the filling go negative", () => {
    const w = builtPortionWeightG({
      fillingGramsPerBatch: 100,
      builderFillingDeductionGrams: 500,
      assemblyGramsPerBatch: 0,
      doughGramsPerPortion: 100,
      portionsPerBatch: 10,
    });
    expect(w).toBe(100);
  });

  it("guards against a zero portions-per-batch", () => {
    const w = builtPortionWeightG({
      fillingGramsPerBatch: 300,
      builderFillingDeductionGrams: 0,
      assemblyGramsPerBatch: 0,
      doughGramsPerPortion: 0,
      portionsPerBatch: 0,
    });
    expect(w).toBe(300);
  });
});

describe("builtPackTargetWeightG", () => {
  it("gives the Philly 2-pack its 604g plus the tray", () => {
    expect(builtPackTargetWeightG(302, 2, 0)).toBe(604);
    expect(builtPackTargetWeightG(302, 2, 25)).toBe(629);
  });
});
