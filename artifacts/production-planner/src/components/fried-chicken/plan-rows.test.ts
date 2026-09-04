import { describe, it, expect } from "vitest";
import {
  mergeSuggestionWithPlan, runTotals, daysCoverAfter,
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
