import { describe, it, expect } from "vitest";
import {
  resolveReminderDisplay,
  stockCheckConditionApplies,
  factoryCountConditionApplies,
  conditionsOffered,
  reminderShownByPrepPanel,
  countAlarmPhase,
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

describe("reminderShownByPrepPanel — one warning on prep screens, not two (13 Oct 2026)", () => {
  const prepStockCheck = { onlyIfStockChecksOutstanding: true };

  it("the prep stock-check reminder stands down on every prep screen (the panel shows it)", () => {
    for (const station of ["prep", "main_prep", "prep_bases", "prep_meat"]) {
      expect(reminderShownByPrepPanel(prepStockCheck, station)).toBe(true);
    }
  });

  it("other reminders still show on prep, and packing/wrapping are untouched", () => {
    expect(reminderShownByPrepPanel({}, "prep")).toBe(false);
    expect(reminderShownByPrepPanel({ onlyIfFactoryCountOutstanding: true }, "prep")).toBe(false);
    expect(reminderShownByPrepPanel(prepStockCheck, "packing")).toBe(false);
    expect(reminderShownByPrepPanel({ onlyIfFactoryCountOutstanding: true }, "wrapping")).toBe(false);
  });
});

describe("count alarm phase (Graeme, 2026-10-15: can't be missed on wrapping)", () => {
  const count = { startTime: "14:45", endTime: "15:00", onlyIfFactoryCountOutstanding: true };
  const plain = { startTime: "14:45", endTime: "15:00" };
  const at = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 3600 + m * 60; };
  it("is nothing before the start, a warning inside the window", () => {
    expect(countAlarmPhase(count, "wrapping", at("14:44"))).toBe("none");
    expect(countAlarmPhase(count, "wrapping", at("14:45"))).toBe("warning");
    expect(countAlarmPhase(count, "packing", at("14:59"))).toBe("warning");
  });
  it("stays as overdue after the deadline on packing/wrapping only", () => {
    expect(countAlarmPhase(count, "wrapping", at("15:00"))).toBe("overdue");
    expect(countAlarmPhase(count, "packing", at("17:30"))).toBe("overdue");
    expect(countAlarmPhase(count, "ovens", at("15:30"))).toBe("none");
  });
  it("other reminders just end at their deadline", () => {
    expect(countAlarmPhase(plain, "wrapping", at("15:01"))).toBe("none");
  });
});
