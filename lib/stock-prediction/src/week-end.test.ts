import { describe, it, expect } from "vitest";
import {
  weekEndFactoryNumber, plannedTwoPackPacks, formatEndPacks, describeWeekEnd,
  type WeekEndDay, type WeekEndInput,
} from "./week-end";

// Worked week: Mon 12 – Sun 18 Oct 2026. "Today" moves per test.
const day = (date: string, o: Partial<WeekEndDay> = {}): WeekEndDay => ({
  date, isDispatchDay: true, plannedPacks: 0, hasPlan: true, knownOrderPacks: 0,
  late: { latePacks: 0, low: 0, high: 0, closed: false }, ...o,
});
const weekend = (date: string): WeekEndDay => day(date, { isDispatchDay: false, hasPlan: false, late: null });
const base = (o: Partial<WeekEndInput>): WeekEndInput => ({
  today: "2026-10-14", weekEnd: "2026-10-18", stockNow: 800, stillToWrapToday: 0, stillToDispatchToday: 0, days: [], ...o,
});

describe("plannedTwoPackPacks", () => {
  it("is batches × portions ÷ pack size, less 4 two-packs per 8-pack bag", () => {
    // 20 batches × 10 calzones ÷ 2 = 100 packs; 5 bags = 20 two-packs' worth.
    expect(plannedTwoPackPacks({ batchesTarget: 20, portionsPerBatch: 10, packSize: 2, eightPackBagCount: 5 })).toBe(80);
    expect(plannedTwoPackPacks({ batchesTarget: 20, portionsPerBatch: 10, packSize: 2, eightPackBagCount: null })).toBe(100);
    expect(plannedTwoPackPacks({ batchesTarget: 1, portionsPerBatch: 10, packSize: 2, eightPackBagCount: 9 })).toBe(0);
  });
});

describe("weekEndFactoryNumber", () => {
  it("Wednesday worked example: stock + still to make − orders placed, then − normal further orders", () => {
    const res = weekEndFactoryNumber(base({
      stockNow: 800,
      stillToWrapToday: 150,      // Wed's plan still being wrapped
      stillToDispatchToday: 300,  // Wed's orders not yet scanned out
      days: [
        day("2026-10-12", { plannedPacks: 999, knownOrderPacks: 999 }), // before today — ignored
        day("2026-10-14", { plannedPacks: 999, knownOrderPacks: 999, late: { latePacks: 40, low: 20, high: 70, closed: false } }),
        day("2026-10-15", { plannedPacks: 500, knownOrderPacks: 250, late: { latePacks: 120, low: 80, high: 170, closed: false } }),
        day("2026-10-16", { plannedPacks: 450, knownOrderPacks: 200, late: { latePacks: 200, low: 140, high: 260, closed: false } }),
        weekend("2026-10-17"),
        weekend("2026-10-18"),
      ],
    }));
    // 800 + (150 + 500 + 450) − (300 + 250 + 200) = 1,150
    expect(res.status).toBe("ok");
    expect(res.toMake).toBe(1100);
    expect(res.toDispatch).toBe(750);
    expect(res.ifNoMoreOrders).toBe(1150);
    // 40 + 120 + 200 = 360 more normally ordered → 790
    expect(res.expectedMore).toBe(360);
    expect(res.predicted).toBe(790);
    // ranges add: up = 30+50+60 = 140, down = 20+40+60 = 120
    expect(res.predictedLow).toBe(650);
    expect(res.predictedHigh).toBe(910);
    expect(res.unplannedDays).toEqual([]);
    expect(describeWeekEnd(res)).toBe("End of week in the fridge: 1,150 packs if nothing else sells · ~790 predicted");
  });

  it("nothing left to sell: after Friday's cut-off both numbers are the same", () => {
    const res = weekEndFactoryNumber(base({
      today: "2026-10-16", stockNow: 600, stillToWrapToday: 0, stillToDispatchToday: 120,
      days: [
        day("2026-10-16", { late: { latePacks: 0, low: 0, high: 0, closed: true } }),
        weekend("2026-10-17"), weekend("2026-10-18"),
      ],
    }));
    expect(res.ifNoMoreOrders).toBe(480);
    expect(res.expectedMore).toBe(0);
    expect(res.predicted).toBe(480);
    expect(res.predictedLow).toBe(480);
    expect(res.predictedHigh).toBe(480);
  });

  it("on Sunday nothing moves: the end is the stock now", () => {
    const res = weekEndFactoryNumber(base({ today: "2026-10-18", stockNow: 512, days: [weekend("2026-10-18")] }));
    expect(res.ifNoMoreOrders).toBe(512);
    expect(res.predicted).toBe(512);
  });

  it("a day with no deliveries (a non-despatch bank holiday) takes nothing out and needs no forecast", () => {
    const res = weekEndFactoryNumber(base({
      today: "2026-10-14", stockNow: 400, stillToWrapToday: 0, stillToDispatchToday: 100,
      days: [
        day("2026-10-14", { late: { latePacks: 0, low: 0, high: 0, closed: true } }),
        // Thursday: no despatch — its stray "orders" and missing forecast are ignored.
        day("2026-10-15", { isDispatchDay: false, hasPlan: false, knownOrderPacks: 75, late: null }),
        day("2026-10-16", { plannedPacks: 0, hasPlan: true, knownOrderPacks: 50, late: { latePacks: 30, low: 10, high: 60, closed: false } }),
        weekend("2026-10-17"), weekend("2026-10-18"),
      ],
    }));
    expect(res.ifNoMoreOrders).toBe(250);
    expect(res.predicted).toBe(220);
    expect(res.predictionGap).toEqual([]);
    expect(res.unplannedDays).toEqual([]);
  });

  it("a negative end is kept and reads as a shortfall", () => {
    const res = weekEndFactoryNumber(base({
      today: "2026-10-15", stockNow: 100, stillToWrapToday: 50, stillToDispatchToday: 120,
      days: [
        day("2026-10-15", { late: { latePacks: 0, low: 0, high: 0, closed: true } }),
        day("2026-10-16", { plannedPacks: 0, hasPlan: false, knownOrderPacks: 40, late: { latePacks: 30, low: 20, high: 45, closed: false } }),
        weekend("2026-10-17"), weekend("2026-10-18"),
      ],
    }));
    // 100 + 50 − 120 − 40 = −10; − 30 = −40
    expect(res.ifNoMoreOrders).toBe(-10);
    expect(res.predicted).toBe(-40);
    expect(res.unplannedDays).toEqual(["2026-10-16"]);
    expect(res.tightest).toEqual({ date: "2026-10-16", packs: -40 });
    expect(formatEndPacks(-40, true)).toBe("short by ~40 packs");
    expect(describeWeekEnd(res, () => "Fri")).toBe("End of week in the fridge: short by 10 packs if nothing else sells · short by ~40 predicted · no plan yet for Fri, so nothing counted as made");
  });

  it("reports a mid-week low that later production makes good", () => {
    const res = weekEndFactoryNumber(base({
      today: "2026-10-14", stockNow: 100, stillToWrapToday: 0, stillToDispatchToday: 200,
      days: [
        day("2026-10-14", { late: { latePacks: 0, low: 0, high: 0, closed: true } }),
        day("2026-10-15", { plannedPacks: 600, knownOrderPacks: 100 }),
        day("2026-10-16", { plannedPacks: 0, knownOrderPacks: 100 }),
        weekend("2026-10-17"), weekend("2026-10-18"),
      ],
    }));
    expect(res.ifNoMoreOrders).toBe(300);
    expect(res.tightest).toEqual({ date: "2026-10-14", packs: -100 });
  });

  it("no forecast for an open despatch → the known figure only, and says why", () => {
    const res = weekEndFactoryNumber(base({
      today: "2026-10-15", stockNow: 500, stillToDispatchToday: 100,
      days: [
        day("2026-10-15", { late: { latePacks: 10, low: 5, high: 20, closed: false } }),
        day("2026-10-16", { knownOrderPacks: 80, late: null }),
        weekend("2026-10-17"), weekend("2026-10-18"),
      ],
    }));
    expect(res.ifNoMoreOrders).toBe(320);
    expect(res.predicted).toBeNull();
    expect(res.expectedMore).toBeNull();
    expect(res.predictionGap).toEqual(["2026-10-16"]);
    expect(describeWeekEnd(res, () => "Fri")).toBe("End of week in the fridge: 320 packs if nothing else sells · no prediction for Fri (not enough order history)");
  });

  it("no stock count → says so instead of a number", () => {
    const res = weekEndFactoryNumber(base({ stockNow: null }));
    expect(res.status).toBe("no-stock-count");
    expect(res.ifNoMoreOrders).toBeNull();
    expect(describeWeekEnd(res)).toMatch(/no factory number count/);
  });

  it("today's orders unreadable on a despatch day → no figure", () => {
    const res = weekEndFactoryNumber(base({ stillToDispatchToday: null, days: [day("2026-10-14")] }));
    expect(res.status).toBe("no-today-orders");
    expect(res.predicted).toBeNull();
  });

  it("a finished week is left to the recorded end", () => {
    expect(weekEndFactoryNumber(base({ today: "2026-10-19" })).status).toBe("week-over");
  });

  it("today missing from the days list still counts today's wrapping", () => {
    const res = weekEndFactoryNumber(base({ today: "2026-10-17", stockNow: 300, stillToWrapToday: 40, stillToDispatchToday: null, days: [] }));
    expect(res.status).toBe("ok");
    expect(res.ifNoMoreOrders).toBe(340);
  });
});

describe("best guess — making what we could on unplanned days (26 Oct 2026)", () => {
  // Monday: 1,100 in the fridge, 1,000 planned, 1,531 to go out, Wed–Fri unplanned.
  const late = (latePacks: number) => ({ latePacks, low: latePacks - 50, high: latePacks + 50, closed: false });
  const input = {
    today: "2026-10-26", weekEnd: "2026-11-01", stockNow: 1100, stillToWrapToday: 500, stillToDispatchToday: 400,
    days: [
      { date: "2026-10-26", isDispatchDay: true, plannedPacks: 0, hasPlan: true, knownOrderPacks: 0, late: late(0) },
      { date: "2026-10-27", isDispatchDay: true, plannedPacks: 500, hasPlan: true, knownOrderPacks: 400, late: late(100) },
      { date: "2026-10-28", isDispatchDay: true, plannedPacks: 0, hasPlan: false, knownOrderPacks: 300, late: late(200), couldMakePacks: 500 },
      { date: "2026-10-29", isDispatchDay: true, plannedPacks: 0, hasPlan: false, knownOrderPacks: 231, late: late(300), couldMakePacks: 500 },
      { date: "2026-10-30", isDispatchDay: true, plannedPacks: 0, hasPlan: false, knownOrderPacks: 200, late: late(336), couldMakePacks: 500 },
    ],
  };
  it("adds what we could make, and keeps the plans-only prediction", () => {
    const r = weekEndFactoryNumber(input);
    expect(r.ifNoMoreOrders).toBe(1100 + 1000 - 1531);
    expect(r.predicted).toBe(569 - 936);
    expect(r.couldMake).toBe(1500);
    expect(r.bestGuess).toBe(569 + 1500 - 936);
    expect(r.unplannedDays).toEqual(["2026-10-28", "2026-10-29", "2026-10-30"]);
  });
  it("selling faster than normal takes more off", () => {
    const r = weekEndFactoryNumber({ ...input, salesFactor: 1.1 });
    expect(r.bestGuessMore).toBe(Math.round(936 * 1.1));
    expect(r.bestGuess).toBe(Math.round(569 + 1500 - 936 * 1.1));
    expect(r.predicted).toBe(569 - 936);
  });
  it("today's capacity never counts — today has its own plan or none", () => {
    const r = weekEndFactoryNumber({ ...input, days: input.days.map(d => d.date === "2026-10-26" ? { ...d, hasPlan: false, couldMakePacks: 999 } : d) });
    expect(r.couldMake).toBe(1500);
  });
});
