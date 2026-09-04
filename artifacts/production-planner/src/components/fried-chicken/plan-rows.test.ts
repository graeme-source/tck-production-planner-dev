import { describe, it, expect } from "vitest";
import {
  mergeSuggestionWithPlan, runTotals, daysCoverAfter, editsForSuggestion,
  type SuggestionVariant, type PlannedBag,
} from "./plan-rows";

function variant(over: Partial<SuggestionVariant> & { recipeId: number }): SuggestionVariant {
  return {
    name: `Recipe ${over.recipeId}`,
    stockPacks: 0,
    soldLast30: 0,
    dptPercent: 0,
    kgPerPack: 1,
    packs: 0,
    stockAfter: 0,
    daysCoverNow: null,
    ...over,
  };
}

describe("mergeSuggestionWithPlan", () => {
  it("takes the suggestion when nothing is on the plan yet", () => {
    const rows = mergeSuggestionWithPlan([variant({ recipeId: 1, packs: 70 })], []);
    expect(rows[0]).toMatchObject({ planned: 70, suggested: 70, onPlanAlready: false, made: 0 });
  });

  it("keeps what the plan already says rather than overwriting it", () => {
    // The whole point: someone set 40 last night, the suggestion has since
    // moved to 70 because stock sold through. Re-opening the dialog must not
    // silently replace their decision.
    const rows = mergeSuggestionWithPlan(
      [variant({ recipeId: 1, packs: 70 })],
      [{ recipeId: 1, packs: 40, made: 0 }],
    );
    expect(rows[0]).toMatchObject({ planned: 40, suggested: 70, onPlanAlready: true });
  });

  it("keeps a deliberate zero on the plan", () => {
    const rows = mergeSuggestionWithPlan(
      [variant({ recipeId: 1, packs: 70 })],
      [{ recipeId: 1, packs: 0, made: 0 }],
    );
    expect(rows[0].planned).toBe(0);
  });

  it("never plans fewer bags than have already been fried", () => {
    const rows = mergeSuggestionWithPlan(
      [variant({ recipeId: 1, packs: 10 })],
      [{ recipeId: 1, packs: 5, made: 12 }],
    );
    expect(rows[0]).toMatchObject({ planned: 12, made: 12 });
  });

  it("leaves a variant the suggestion skipped at zero", () => {
    const rows = mergeSuggestionWithPlan(
      [variant({ recipeId: 1, packs: 0, stockPacks: 60 })],
      [],
    );
    expect(rows[0].planned).toBe(0);
  });
});

describe("editsForSuggestion", () => {
  it("puts every row back on the suggestion", () => {
    // The whole point: a saved plan's rows baseline to their saved packs,
    // so a full replan needs explicit edits, not cleared ones.
    expect(editsForSuggestion([
      { recipeId: 24, suggested: 83, made: 0 },
      { recipeId: 29, suggested: 121, made: 0 },
    ])).toEqual({ 24: 83, 29: 121 });
  });

  it("never plans below what's already been fried", () => {
    // 40 bags off the fryer with a suggestion of 20: the suggestion lost —
    // those bags exist and the count is the truth.
    expect(editsForSuggestion([{ recipeId: 24, suggested: 20, made: 40 }])).toEqual({ 24: 40 });
  });
});

describe("runTotals", () => {
  it("costs the planned bags against the budget", () => {
    const totals = runTotals(
      [{ planned: 10, kgPerPack: 1.2 }, { planned: 20, kgPerPack: 0.5 }],
      40,
      0.457,
    );
    expect(totals.packs).toBe(30);
    expect(totals.kgUsed).toBe(22);
    expect(totals.kgSpare).toBe(18);
    expect(totals.kgOver).toBe(0);
    expect(totals.oilKg).toBe(10.1);
  });

  it("reports going over the budget rather than hiding it", () => {
    // The chicken was ordered against the run size, so overspending it is a
    // real-world problem — the screen has to say so, not clamp quietly.
    const totals = runTotals([{ planned: 100, kgPerPack: 1 }], 75, 0.457);
    expect(totals.kgOver).toBe(25);
    expect(totals.kgSpare).toBe(0);
  });

  it("totals the packed weight out from each bag's make-up", () => {
    // Raw in vs packed out is the run's mass balance. The old paper sheet
    // assumed raw ≈ packed; the recipes say otherwise, and the difference
    // was invisible until both numbers were on screen together.
    const totals = runTotals(
      [
        { planned: 10, kgPerPack: 0.371, makeUp: [{ name: "strip", kg: 0.4 }] },
        { planned: 5, kgPerPack: 0.31, makeUp: [{ name: "strip", kg: 0.334 }, { name: "sauce", kg: 0.166 }] },
      ],
      40,
      0.457,
    );
    // 10 × 0.4 + 5 × (0.334 + 0.166) = 6.5
    expect(totals.packedKg).toBe(6.5);
  });

  it("shows zero packed weight when the make-up isn't loaded, not nonsense", () => {
    const totals = runTotals([{ planned: 10, kgPerPack: 0.4 }], 40, 0.457);
    expect(totals.packedKg).toBe(0);
  });

  it("sizes the oil off the chicken actually planned, not the nominal run", () => {
    const totals = runTotals([{ planned: 10, kgPerPack: 1 }], 75, 0.5);
    expect(totals.oilKg).toBe(5);
  });

  it("ignores negative entries rather than crediting them", () => {
    const totals = runTotals([{ planned: -5, kgPerPack: 1 }, { planned: 3, kgPerPack: 1 }], 10, 0);
    expect(totals.packs).toBe(3);
    expect(totals.kgUsed).toBe(3);
  });
});

describe("daysCoverAfter", () => {
  it("counts the planned bags into the cover", () => {
    expect(daysCoverAfter({ stockPacks: 10, planned: 20, soldLast30: 30 }, 30)).toBe(30);
  });

  it("says nothing rather than inventing a number when nothing has sold", () => {
    expect(daysCoverAfter({ stockPacks: 10, planned: 20, soldLast30: 0 }, 30)).toBeNull();
  });
});
