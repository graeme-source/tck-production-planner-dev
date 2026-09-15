import { describe, it, expect } from "vitest";
import { stockCellEdited, planStockWrite } from "./stock-override-guard";

// Regression tests for the 2026-09-14 incident: the mac cheese calculator's
// Stock column silently auto-saved keystrokes (including a transient 0 from a
// cleared field) into Stock Control. The guard makes every write an explicit,
// described decision — these pin down that decision logic.

describe("stockCellEdited", () => {
  it("is false for an untouched cell", () => {
    expect(stockCellEdited(undefined, 8)).toBe(false);
  });

  it("is false when the typed value matches the server value", () => {
    expect(stockCellEdited(8, 8)).toBe(false);
  });

  it("is true when the typed value differs", () => {
    expect(stockCellEdited(22, 8)).toBe(true);
  });

  it("treats a cleared field (reported as 0) as an edit, never a match", () => {
    // In the incident, clearing the field auto-wrote 0 to Stock Control.
    // Under the guard a 0 is edit-state like any other — it can only reach
    // Stock Control through the explicit confirm.
    expect(stockCellEdited(0, 8)).toBe(true);
  });

  it("is false when a cleared field matches a genuine server 0", () => {
    expect(stockCellEdited(0, 0)).toBe(false);
  });
});

describe("planStockWrite", () => {
  it("describes the exact Stock Control change (incident numbers: 8 → 22)", () => {
    const plan = planStockWrite(22, 8, 0);
    expect(plan.newLevel).toBe(22);
    expect(plan.currentLevel).toBe(8);
    expect(plan.delta).toBe(14);
    expect(plan.dispatchWarning).toBeNull();
  });

  it("shows a negative delta when the write lowers stock", () => {
    const plan = planStockWrite(0, 8, 0);
    expect(plan.delta).toBe(-8);
  });

  it("warns when today's orders are still to be scanned out", () => {
    const plan = planStockWrite(20, 25, 5);
    expect(plan.dispatchWarning).toContain("5 packs");
  });

  it("uses singular wording for one outstanding pack", () => {
    const plan = planStockWrite(20, 25, 1);
    expect(plan.dispatchWarning).toContain("1 pack ");
  });

  it("never plans a negative level and rounds fractional input", () => {
    const plan = planStockWrite(-3, 7.6, 0);
    expect(plan.newLevel).toBe(0);
    expect(plan.currentLevel).toBe(8);
    expect(plan.delta).toBe(-8);
  });
});
