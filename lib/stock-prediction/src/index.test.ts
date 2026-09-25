import { describe, it, expect } from "vitest";
import {
  planStartStock,
  interveningDispatchDays,
  plannedProductionPacks,
  remainingWrappingPacks,
  type WrappingProgressRow,
} from "./index";

// ── Reference copies of the calzone Factory Number maths ──────────────────
// Verbatim from routes/production-plans.ts calculatePlanData() as it stood
// before the extraction (2026-09-25). The shared functions must reproduce
// these for every input, so switching the calzone path over changes nothing.
function legacyRemainingWrapping(row: WrappingProgressRow): number {
  const portionsPerBatch = Number(row.portionsPerBatch) || 10;
  const packSize = Number(row.packSize) || 1;
  const packsPerBatch = portionsPerBatch / packSize;
  const targetPacks = (row.batchesTarget ?? 0) * packsPerBatch;
  const bagEquiv = 8 / packSize;
  const bagsWrapped = row.fridgeEightPackQty ?? 0;
  const bagsStillToCome = Math.max(0, (row.eightPackBagCount ?? 0) - bagsWrapped);
  const accountedFor = (row.fridgeQty ?? 0)
    + bagsWrapped * bagEquiv
    + (row.freezerQty ?? 0)
    + (row.wonlyCount ?? 0);
  return row.wrappingComplete
    ? 0
    : Math.max(0, targetPacks - accountedFor - bagsStillToCome * bagEquiv);
}
function legacyPrevProductionPacks(row: { batchesTarget: number | null; portionsPerBatch: number | string | null; packSize: number | string | null }): number {
  const portionsPerBatch = Number(row.portionsPerBatch) || 10;
  const packSize = Number(row.packSize) || 1;
  const packsPerBatch = portionsPerBatch / packSize;
  return (row.batchesTarget ?? 0) * packsPerBatch;
}
function legacyFactoryNumber(fridgeStock: number, wrapRemain: number, fulRemain: number, planAhead: boolean, prevProduction: number, dispatch1Qty: number) {
  const predictedFridgeStock = Math.max(0, Math.round(fridgeStock + wrapRemain - fulRemain));
  const estimatedFactoryNumberRaw = Math.max(0, predictedFridgeStock + (planAhead ? prevProduction - dispatch1Qty : 0));
  return { predictedFridgeStock, estimatedFactoryNumberRaw };
}

// Deterministic pseudo-random inputs so a failure is reproducible.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Mon–Fri walker with an optional holiday set, mirroring getNextDispatchDay.
function nextDispatchDay(skip: Set<string> = new Set()) {
  return (from: string) => {
    const d = new Date(`${from}T12:00:00Z`);
    do {
      d.setUTCDate(d.getUTCDate() + 1);
    } while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || skip.has(d.toISOString().slice(0, 10)));
    return d.toISOString().slice(0, 10);
  };
}

describe("calzone Factory Number is unchanged by the extraction", () => {
  it("remainingWrappingPacks matches the old inline loop for every row shape", () => {
    const r = rng(42);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    for (let i = 0; i < 5000; i++) {
      const row: WrappingProgressRow = {
        batchesTarget: pick([null, 0, 1, 7, 20, 36]),
        portionsPerBatch: pick([null, 10, "10.00", 2, 12]),
        packSize: pick([null, 2, "2.0000", 1, 4]),
        fridgeQty: pick([null, 0, 5, 40, 200]),
        fridgeEightPackQty: pick([null, 0, 3, 9]),
        eightPackBagCount: pick([null, 0, 5, 12]),
        freezerQty: pick([null, 0, 4]),
        wonlyCount: pick([null, 0, 2, 6]),
        wrappingComplete: pick([null, false, true]),
      };
      expect(remainingWrappingPacks(row)).toBe(legacyRemainingWrapping(row));
      expect(plannedProductionPacks(row)).toBe(legacyPrevProductionPacks(row));
    }
  });

  it("planStartStock reproduces predictedFridgeStock and the plan-ahead roll-forward", () => {
    const r = rng(7);
    for (let i = 0; i < 5000; i++) {
      const fridge = Math.round(r() * 300) - 20; // a stale count can be negative-ish
      const wrap = Math.round(r() * 120 * 10) / 10; // fractional packs happen
      const ful = Math.round(r() * 150);
      const planAhead = r() < 0.5;
      const prev = Math.round(r() * 200);
      const d1 = Math.round(r() * 200);
      const legacy = legacyFactoryNumber(fridge, wrap, ful, planAhead, prev, d1);
      const shared = planStartStock({
        liveStock: fridge,
        stillToWrapToday: wrap,
        stillToDispatchToday: ful,
        rollForward: planAhead ? [{ date: "2026-09-24", plannedProductionPacks: prev, dispatchPacks: d1 }] : [],
      });
      expect(shared.endOfToday).toBe(legacy.predictedFridgeStock);
      expect(shared.atPlanStart).toBe(legacy.estimatedFactoryNumberRaw);
    }
  });

  it("rolls forward exactly the day the calzone path used (the plan date's previous working day)", () => {
    // Tue → Thu: Wed is the one day in between.
    expect(interveningDispatchDays("2026-09-22", "2026-09-24", nextDispatchDay())).toEqual(["2026-09-23"]);
    // Plan for the next working day: nothing to roll (calzone planAhead = false).
    expect(interveningDispatchDays("2026-09-23", "2026-09-24", nextDispatchDay())).toEqual([]);
    // Fri → Mon: the weekend isn't a dispatch day, nothing to roll.
    expect(interveningDispatchDays("2026-09-25", "2026-09-28", nextDispatchDay())).toEqual([]);
    // Fri → Tue across a bank-holiday Monday: nothing to roll either.
    expect(interveningDispatchDays("2026-08-28", "2026-09-01", nextDispatchDay(new Set(["2026-08-31"])))).toEqual([]);
    // Thu → Tue: Fri and Mon in between, Mon last (= previous working day).
    expect(interveningDispatchDays("2026-09-24", "2026-09-29", nextDispatchDay())).toEqual(["2026-09-25", "2026-09-28"]);
    // Same-day plan: nothing between.
    expect(interveningDispatchDays("2026-09-25", "2026-09-25", nextDispatchDay())).toEqual([]);
  });
});

// ── The four moments a mac cheese (or any) plan gets made ─────────────────
describe("stock at the start of the plan date", () => {
  it("(a) during today's pack: scanned orders are already off the fridge, only unscanned ones come off", () => {
    // 60 packs were in the fridge this morning, 25 are tagged for today.
    // 15 have been scanned (fridge now reads 45), 10 still to scan.
    const during = planStartStock({ liveStock: 45, stillToWrapToday: 0, stillToDispatchToday: 10 });
    expect(during.atPlanStart).toBe(35);
    // Same answer the moment the pack started, and after it finishes:
    // the figure is stable through the pack, never counting an order twice.
    expect(planStartStock({ liveStock: 60, stillToWrapToday: 0, stillToDispatchToday: 25 }).atPlanStart).toBe(35);
  });

  it("(b) after the pack: nothing left to dispatch, live stock is the answer", () => {
    const after = planStartStock({ liveStock: 35, stillToWrapToday: 0, stillToDispatchToday: 0 });
    expect(after.endOfToday).toBe(35);
    expect(after.atPlanStart).toBe(35);
    expect(after.rollForward).toEqual([]);
  });

  it("(c) while today's batch is still being wrapped: the packs still to come count as stock", () => {
    // Today's mac plan: 18 packs, 5 wrapped so far (already in the live 40).
    const stillToWrap = remainingWrappingPacks({
      batchesTarget: 18, portionsPerBatch: 2, packSize: 2,
      fridgeQty: 5, fridgeEightPackQty: 0, eightPackBagCount: 0, freezerQty: 0, wonlyCount: 0, wrappingComplete: false,
    });
    expect(stillToWrap).toBe(13);
    const result = planStartStock({ liveStock: 40, stillToWrapToday: stillToWrap, stillToDispatchToday: 12 });
    expect(result.atPlanStart).toBe(41); // 40 + 13 − 12
    // Once wrapping is marked complete nothing more is expected.
    expect(remainingWrappingPacks({
      batchesTarget: 18, portionsPerBatch: 2, packSize: 2,
      fridgeQty: 16, fridgeEightPackQty: 0, eightPackBagCount: 0, freezerQty: 0, wonlyCount: 0, wrappingComplete: true,
    })).toBe(0);
  });

  it("(d) two days ahead: the day in between's production and dispatch roll forward", () => {
    // Tuesday afternoon planning Thursday. Wednesday's plan makes 21 packs,
    // Wednesday's dispatch has 14 orders so far.
    const result = planStartStock({
      liveStock: 30, stillToWrapToday: 0, stillToDispatchToday: 6,
      rollForward: [{ date: "2026-09-23", plannedProductionPacks: 21, dispatchPacks: 14 }],
    });
    expect(result.endOfToday).toBe(24);
    expect(result.rolledProductionPacks).toBe(21);
    expect(result.rolledDispatchPacks).toBe(14);
    expect(result.rollForward[0].stockAfter).toBe(31);
    expect(result.atPlanStart).toBe(31);
  });

  it("clamps at zero at the end of every day — a short day isn't back-filled by later production", () => {
    const result = planStartStock({
      liveStock: 5, stillToWrapToday: 0, stillToDispatchToday: 9,
      rollForward: [
        { date: "2026-09-25", plannedProductionPacks: 0, dispatchPacks: 4 },
        { date: "2026-09-28", plannedProductionPacks: 20, dispatchPacks: 8 },
      ],
    });
    expect(result.endOfToday).toBe(0);
    expect(result.rollForward.map(d => d.stockAfter)).toEqual([0, 12]);
    expect(result.atPlanStart).toBe(12);
  });
});

// ── Dog bins (migration 0131): the second kind of quality reject ──────────
// A dog bin is thrown away. It must come off what is still to reach the
// fridge, exactly like a wonky does, but it is never stock anywhere.
describe("dog bins in the still-to-wrap prediction", () => {
  const base: WrappingProgressRow = {
    batchesTarget: 10, portionsPerBatch: 10, packSize: 2, // 50 two-packs planned
    fridgeQty: 20, fridgeEightPackQty: 0, eightPackBagCount: 0,
    freezerQty: 0, wonlyCount: 3, wrappingComplete: false,
  };

  it("a dog bin reduces the packs predicted to reach the fridge", () => {
    expect(remainingWrappingPacks(base)).toBe(27); // 50 − 20 − 3
    expect(remainingWrappingPacks({ ...base, dogBinCount: 2 })).toBe(25); // and 2 in the bin
  });

  it("removing a dog bin (undo) restores the prediction", () => {
    const withBin = remainingWrappingPacks({ ...base, dogBinCount: 1 });
    const undone = remainingWrappingPacks({ ...base, dogBinCount: 0 });
    expect(undone - withBin).toBe(1);
    expect(undone).toBe(remainingWrappingPacks(base));
  });

  it("a dog bin comes off the same as a wonky does, but is its own term", () => {
    expect(remainingWrappingPacks({ ...base, wonlyCount: 3, dogBinCount: 2 }))
      .toBe(remainingWrappingPacks({ ...base, wonlyCount: 5, dogBinCount: 0 }));
  });

  it("wonky behaviour is unchanged: no dog bin field reads exactly as before", () => {
    expect(remainingWrappingPacks({ ...base, dogBinCount: null })).toBe(legacyRemainingWrapping(base));
    expect(remainingWrappingPacks({ ...base, dogBinCount: 0 })).toBe(legacyRemainingWrapping(base));
  });

  it("never goes below zero, and a completed wrap is still zero", () => {
    expect(remainingWrappingPacks({ ...base, dogBinCount: 500 })).toBe(0);
    expect(remainingWrappingPacks({ ...base, dogBinCount: 2, wrappingComplete: true })).toBe(0);
  });
});
