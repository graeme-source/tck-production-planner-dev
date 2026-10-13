import { describe, it, expect } from "vitest";
import {
  resolveReminderDisplay,
  stockCheckConditionApplies,
  factoryCountConditionApplies,
  conditionsOffered,
  type ReminderLiveCounts,
} from "./reminder-conditions";

const none: ReminderLiveCounts = { stockChecksOutstanding: null, factoryCount: null };

describe("stock-check condition is prep-only (Graeme, 13 Oct 2026)", () => {
  // Regression: "Completed count due by 3pm — 2 outstanding" on Packing,
  // where the 2 was two prep ingredient stock checks.
  const packCount = { onlyIfStockChecksOutstanding: true };

  it("never shows prep stock-check numbers on Packing or Wrapping", () => {
    const counts = { ...none, stockChecksOutstanding: 2 };
    for (const station of ["packing", "wrapping"]) {
      expect(stockCheckConditionApplies(packCount, station)).toBe(false);
      expect(resolveReminderDisplay(packCount, station, counts)).toEqual({ show: true, suffix: null });
    }
  });

  it("isn't hidden on Packing just because prep has no stock checks left", () => {
    const counts = { ...none, stockChecksOutstanding: 0 };
    expect(resolveReminderDisplay(packCount, "packing", counts).show).toBe(true);
  });

  it("still applies on prep stations", () => {
    expect(resolveReminderDisplay(packCount, "prep", { ...none, stockChecksOutstanding: 2 }))
      .toEqual({ show: true, suffix: "2 outstanding" });
    expect(resolveReminderDisplay(packCount, "main_prep", { ...none, stockChecksOutstanding: 0 }).show).toBe(false);
  });
});

describe("factory-count condition (Packing/Wrapping)", () => {
  const r = { onlyIfFactoryCountOutstanding: true };

  it("hides the banner once today's count is done", () => {
    const counts = { ...none, factoryCount: { complete: true, outstanding: 0 } };
    expect(resolveReminderDisplay(r, "packing", counts).show).toBe(false);
    expect(resolveReminderDisplay(r, "wrapping", counts).show).toBe(false);
  });

  it("shows how many products are still to count while it isn't", () => {
    const counts = { ...none, factoryCount: { complete: false, outstanding: 5 } };
    expect(resolveReminderDisplay(r, "packing", counts)).toEqual({ show: true, suffix: "5 still to count" });
  });

  it("shows no number when the count has no per-product entries", () => {
    const counts = { ...none, factoryCount: { complete: false, outstanding: null } };
    expect(resolveReminderDisplay(r, "wrapping", counts)).toEqual({ show: true, suffix: null });
  });

  it("stays hidden while the count is still loading", () => {
    expect(resolveReminderDisplay(r, "packing", none).show).toBe(false);
  });

  it("is ignored on prep stations", () => {
    expect(factoryCountConditionApplies(r, "prep")).toBe(false);
    expect(resolveReminderDisplay(r, "prep", none)).toEqual({ show: true, suffix: null });
  });
});

describe("conditionsOffered (editor)", () => {
  it("offers stock checks only when a prep station is chosen", () => {
    expect(conditionsOffered(["wrapping", "packing"])).toEqual({ stockChecks: false, factoryCount: true });
    expect(conditionsOffered(["prep"])).toEqual({ stockChecks: true, factoryCount: false });
    expect(conditionsOffered([])).toEqual({ stockChecks: false, factoryCount: false });
  });
});
