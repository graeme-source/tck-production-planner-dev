import { describe, it, expect } from "vitest";
import { pendingForcedStockChecks, type ForcedStockCheckCandidate } from "./forced-stock-check";

// Issue #360 (Jane, 27 Oct): Raw Meat Prep — Pork 2/2 trays ticked, stock
// check due, no pop-up. Same rule Main Prep already used.
const pork = (over: Partial<ForcedStockCheckCandidate> = {}): ForcedStockCheckCandidate => ({
  ingredientId: 7, dueToday: true, allTicked: true, counted: false, lastTickedByUserId: 11, ...over,
});
const opts = { currentUserId: 11, countsLoaded: true, skippedIds: new Set<number>() };

describe("pendingForcedStockChecks", () => {
  it("pops up for the person who ticked the last tray when the count is due and missing", () => {
    expect(pendingForcedStockChecks([pork()], opts)).toHaveLength(1);
  });
  it("leaves everyone else on the station alone", () => {
    expect(pendingForcedStockChecks([pork({ lastTickedByUserId: 12 })], opts)).toHaveLength(0);
  });
  it("doesn't pop once counted, if not due today, or before every tray is ticked", () => {
    expect(pendingForcedStockChecks([pork({ counted: true })], opts)).toHaveLength(0);
    expect(pendingForcedStockChecks([pork({ dueToday: false })], opts)).toHaveLength(0);
    expect(pendingForcedStockChecks([pork({ allTicked: false })], opts)).toHaveLength(0);
  });
  it("respects Skip", () => {
    expect(pendingForcedStockChecks([pork()], { ...opts, skippedIds: new Set([7]) })).toHaveLength(0);
  });
  it("waits for saved counts to load and for a signed-in user", () => {
    expect(pendingForcedStockChecks([pork()], { ...opts, countsLoaded: false })).toHaveLength(0);
    expect(pendingForcedStockChecks([pork()], { ...opts, currentUserId: null })).toHaveLength(0);
  });
});
