import { describe, it, expect } from "vitest";
import { planStartStock, outOfDateStock, type FridgeShelfBatch } from "./index";

// Fix queue #403 (Kerri-Leigh, 18 Nov 2026): mac cheese was planned around
// 2pm counting 6 packs that then had to be frozen at close-down, so the plan
// came out 6 short. Graeme: apply the shelf-life rule the closing check
// already uses — look forward to the next dispatch, and take off the packs
// that can't go on it.
//
// Mac cheese: 8-day shelf life, customer needs 2 days left, delivery is the
// day after dispatch → last dispatch = use-by − 3.
const batch = (batchNumber: number, packs: number, useByDate: string, lastDispatchDate: string): FridgeShelfBatch =>
  ({ batchNumber, packs, useByDate, lastDispatchDate });
const OLD = batch(26317, 6, "2026-11-21", "2026-11-18");   // made Fri 13 Nov
const NEW = batch(26321, 9, "2026-11-25", "2026-11-22");   // made Tue 17 Nov

describe("packs going out of date before the plan's dispatch", () => {
  it("#403: packs whose last dispatch is today come off a plan for a later day", () => {
    const working = planStartStock({
      liveStock: 15, stillToWrapToday: 0, stillToDispatchToday: 0,
      rollForward: [{ date: "2026-11-19", plannedProductionPacks: 0, dispatchPacks: 0 }],
      shelfLife: { today: "2026-11-18", planDate: "2026-11-20", batches: [OLD, NEW] },
    });
    expect(working.outOfDatePacks).toBe(6);
    expect(working.freezeTodayPacks).toBe(6);
    expect(working.atPlanStart).toBe(9); // was 15 before the fix
    expect(working.outOfDateBatches.map(b => b.batchNumber)).toEqual([26317]);
  });

  it("today's outstanding orders take the oldest packs first, so only the rest is out of date", () => {
    const working = planStartStock({
      liveStock: 15, stillToWrapToday: 0, stillToDispatchToday: 4,
      shelfLife: { today: "2026-11-18", planDate: "2026-11-19", batches: [OLD, NEW] },
    });
    expect(working.outOfDatePacks).toBe(2);
    expect(working.atPlanStart).toBe(9); // 15 − 4 out today − 2 to freeze
  });

  it("a day in between can't send packs that are already past their last dispatch", () => {
    const result = outOfDateStock({
      liveStock: 15, today: "2026-11-18", planDate: "2026-11-20", batches: [OLD, NEW],
      dispatches: [{ date: "2026-11-18", packs: 0 }, { date: "2026-11-19", packs: 5 }],
    });
    expect(result.packs).toBe(6);
  });

  it("packs still good for the plan date's own dispatch are left alone", () => {
    const working = planStartStock({
      liveStock: 15, stillToWrapToday: 0, stillToDispatchToday: 0,
      shelfLife: { today: "2026-11-17", planDate: "2026-11-18", batches: [OLD, NEW] },
    });
    expect(working.outOfDatePacks).toBe(0);
    expect(working.atPlanStart).toBe(15);
  });

  it("the fridge count goes to the newest batches first, so old never-drained rows don't cry wolf", () => {
    const ghost = batch(26307, 16, "2026-11-11", "2026-11-08");
    const working = planStartStock({
      liveStock: 9, stillToWrapToday: 0, stillToDispatchToday: 0,
      shelfLife: { today: "2026-11-18", planDate: "2026-11-19", batches: [ghost, OLD, NEW] },
    });
    expect(working.outOfDatePacks).toBe(0);
    expect(working.atPlanStart).toBe(9);
  });

  it("a corrected fridge count re-works the out-of-date packs from the new count", () => {
    const working = planStartStock({
      liveStock: 15, stillToWrapToday: 0, stillToDispatchToday: 0,
      shelfLife: { today: "2026-11-18", planDate: "2026-11-19", batches: [OLD, NEW] },
    });
    expect(working.atPlanStart).toBe(9);
    // The six are frozen and the operator re-counts 9: nothing more comes off.
    const recounted = planStartStock({ ...working, liveStock: 9 });
    expect(recounted.outOfDatePacks).toBe(0);
    expect(recounted.atPlanStart).toBe(9);
  });

  it("never takes off more than the stock that is there, and fresh stock is untouched", () => {
    const working = planStartStock({
      liveStock: 6, stillToWrapToday: 10, stillToDispatchToday: 0,
      shelfLife: { today: "2026-11-18", planDate: "2026-11-19", batches: [OLD] },
    });
    expect(working.outOfDatePacks).toBe(6);
    expect(working.atPlanStart).toBe(10);
  });

  it("without batch information nothing changes (the calzone path)", () => {
    const working = planStartStock({ liveStock: 15, stillToWrapToday: 2, stillToDispatchToday: 3 });
    expect(working.outOfDatePacks).toBe(0);
    expect(working.outOfDateBatches).toEqual([]);
    expect(working.atPlanStart).toBe(14);
  });
});
