import { describe, it, expect } from "vitest";
import {
  elapsedPaidHours, payToNow, isWorkedStatus, liveLabour, estimateToday, viewerToday,
  type LiveShift, type LiveLabourInputs,
} from "./team-efficiency-today";
import { madeByLine, FALLBACK_SETTINGS, type DayComponents, type PlanItemInput, type TeSettings } from "./team-efficiency-day";

const RATE = 10;
// Shaped like a real Planday row for today: 07:00–16:00 scheduled, with the
// break rules Planday schedules (20 min at 09:00, 25 min at 10:00), unpaid.
function shift(p: Partial<LiveShift> = {}): LiveShift {
  return {
    id: 1, employeeId: 1, date: "2026-09-25", positionId: 1,
    salary: 9 * RATE,
    start: "2026-09-25T07:00:00", end: "2026-09-25T16:00:00",
    breaks: [
      { start: "2026-09-25T09:00:00", end: "2026-09-25T09:20:00", duration: 1 / 3, amount: -RATE / 3, isPaid: false },
      { start: "2026-09-25T10:00:00", end: "2026-09-25T10:25:00", duration: 25 / 60, amount: -RATE * 25 / 60, isPaid: false },
    ],
    ...p,
  };
}

describe("elapsedPaidHours", () => {
  it("counts nothing before the shift starts", () => {
    expect(elapsedPaidHours(shift(), "2026-09-25T06:30:00")).toBe(0);
  });
  it("counts time up to now, before any break is due", () => {
    expect(elapsedPaidHours(shift(), "2026-09-25T08:30:00")).toBeCloseTo(1.5, 6);
  });
  it("takes off only the part of a break already taken", () => {
    expect(elapsedPaidHours(shift(), "2026-09-25T09:10:00")).toBeCloseTo(2 + 10 / 60 - 10 / 60, 6);
  });
  it("takes off breaks that are over", () => {
    expect(elapsedPaidHours(shift(), "2026-09-25T12:00:00")).toBeCloseTo(5 - 45 / 60, 6);
  });
  it("stops at the scheduled end: the whole shift less all its breaks", () => {
    expect(elapsedPaidHours(shift(), "2026-09-25T18:00:00")).toBeCloseTo(9 - 45 / 60, 6);
  });
  it("accepts rota-style times without seconds", () => {
    expect(elapsedPaidHours(shift({ start: "2026-09-25T07:00", end: "2026-09-25T16:00" }), "2026-09-25T08:00:00")).toBeCloseTo(1, 6);
  });
  it("spreads a break without times across the shift", () => {
    const s = shift({ breaks: [{ duration: 0.9, amount: -9, isPaid: false }, { duration: 0.25, amount: 0, isPaid: true }] });
    expect(elapsedPaidHours(s, "2026-09-25T11:30:00")).toBeCloseTo(4.5 - 0.9 * 0.5, 6);
  });
});

describe("payToNow", () => {
  it("is break-deducted pay for the part worked", () => {
    expect(payToNow(shift(), "2026-09-25T12:00:00")).toBeCloseTo((5 - 0.75) * RATE, 6);
    expect(payToNow(shift(), "2026-09-25T20:00:00")).toBeCloseTo((9 - 0.75) * RATE, 6);
    expect(payToNow(shift(), "2026-09-25T05:00:00")).toBe(0);
  });
});

const PRODUCTION = 100;
const baseInputs = (p: Partial<LiveLabourInputs>): LiveLabourInputs => ({
  today: "2026-09-28", now: "2026-09-28T12:00:00",
  shifts: [], rota: new Map(),
  positions: [
    { id: 1, name: "Builder 1", sectionId: PRODUCTION },
    { id: 2, name: "Frying", sectionId: PRODUCTION },
    { id: 3, name: "Scheduling", sectionId: 200 },
  ],
  shiftTypes: [{ id: 9, name: "Training" }],
  productionSectionId: PRODUCTION,
  sortedPlanDates: ["2026-09-25", "2026-09-28"],
  nonDispatchDays: new Set(),
  linePositions: { "Line B": ["Frying"] },
  multipliers: new Map(), fallbackMultiplier: 1.2,
  ...p,
});
const monday = (id: number, positionId: number, extra: Partial<LiveShift> = {}) =>
  shift({ id, employeeId: id, positionId, date: "2026-09-28", start: "2026-09-28T07:00:00", end: "2026-09-28T16:00:00",
    breaks: [{ start: "2026-09-28T09:00:00", end: "2026-09-28T09:45:00", duration: 0.75, amount: -7.5, isPaid: false }], ...extra });

describe("liveLabour", () => {
  it("counts clocked-in Production shifts up to now, with the on-cost multiplier", () => {
    const out = liveLabour(baseInputs({
      shifts: [monday(1, 1), monday(2, 3), monday(3, 1), monday(4, 1)],
      rota: new Map([
        [1, { status: "PunchclockStarted", shiftTypeId: null }],
        [2, { status: "PunchclockStarted", shiftTypeId: null }], // office
        [3, { status: "Assigned", shiftTypeId: null }],          // not clocked in
        [4, { status: "PunchclockFinished", shiftTypeId: 9 }],   // training
      ]),
    }));
    expect(out.shiftsCounted).toBe(1);
    expect(out.shiftsNotStarted).toBe(1);
    expect(out.paidHours).toBeCloseTo(5 - 0.75, 6);
    expect(out.labourCostTotal).toBeCloseTo((5 - 0.75) * RATE * 1.2, 6);
  });

  it("brings Sunday's dough prep into Monday, and keeps line-only pay separate", () => {
    const sunday = shift({ id: 5, employeeId: 5, positionId: 1, date: "2026-09-27", start: "2026-09-27T09:00:00", end: "2026-09-27T12:00:00", breaks: [], salary: 3 * RATE });
    const out = liveLabour(baseInputs({
      shifts: [sunday, monday(6, 2)],
      rota: new Map([[5, { status: "Approved", shiftTypeId: null }], [6, { status: "PunchclockStarted", shiftTypeId: null }]]),
    }));
    expect(out.shiftsCounted).toBe(2);
    expect(out.headcount).toBe(2);
    expect(out.labourCostTotal).toBeCloseTo((3 + 4.25) * RATE * 1.2, 6);
    expect(out.lineLabour["Line B"]).toBeCloseTo(4.25 * RATE * 1.2, 6);
  });

  it("knows which statuses mean someone clocked in", () => {
    expect(isWorkedStatus("PunchclockStarted")).toBe(true);
    expect(isWorkedStatus("Approved")).toBe(true);
    expect(isWorkedStatus("Assigned")).toBe(false);
    expect(isWorkedStatus(null)).toBe(false);
  });
});

const settings: TeSettings = { ...FALLBACK_SETTINGS, standardRatio: 4, despatchShare: 0.1, discountRates: { "Line A": 0.2 }, linePositions: { "Line B": ["Frying"] } };
const item = (p: Partial<PlanItemInput>): PlanItemInput => ({
  category: "Line A", fridgeQty: 0, eightPackBags: 0, batchesTarget: 40, batchesComplete: 0, portionsPerBatch: 10, packSize: 2, rrp: 10, ...p,
});
const comps = (p: Partial<DayComponents>): DayComponents => ({
  date: "2026-09-28", made: {}, despatched: {}, ordersDespatched: 0, labourCostTotal: 500, lineLabour: {},
  paidHours: 30, headcount: 7, pendingShifts: 0, ignoredUnapproved: 0, ...p,
});
const extra = { shiftsCounted: 7, shiftsNotStarted: 1, asOf: "2026-09-28T11:00:00.000Z", hasPlan: true };

describe("estimateToday", () => {
  it("estimates from packs counted and labour so far, without excluding a half-counted day", () => {
    const e = estimateToday(comps({ made: madeByLine([item({ fridgeQty: 60 })]) }), settings, extra);
    expect(e.status).toBe("estimate");
    const credited = 0.9 * 600 * 0.8;
    expect(e.valueCredited).toBeCloseTo(credited, 6);
    expect(e.estimatePct).toBeCloseTo((credited / 500 / 4) * 100, 6);
    expect(e.notes).toEqual(["Line A: 60 of 200 planned packs counted so far"]);
  });

  it("waits for counts rather than showing 0%", () => {
    const e = estimateToday(comps({ made: madeByLine([item({})]) }), settings, extra);
    expect(e.status).toBe("waiting_for_counts");
    expect(e.estimatePct).toBeNull();
    expect(e.notes).toEqual(["Nothing counted yet for Line A"]);
  });

  it("says when nobody has clocked in, and when there's no plan", () => {
    expect(estimateToday(comps({ made: madeByLine([item({ fridgeQty: 10 })]), labourCostTotal: 0 }), settings, extra).status).toBe("no_labour");
    expect(estimateToday(comps({}), settings, { ...extra, hasPlan: false }).status).toBe("no_plan");
  });

  it("takes line-only pay off when that line isn't in today's plan", () => {
    const e = estimateToday(comps({ made: madeByLine([item({ fridgeQty: 200 })]), lineLabour: { "Line B": 100 } }), settings, extra);
    expect(e.labourCost).toBe(400);
    expect(e.notes[0]).toMatch(/Line B staff/);
  });
});

describe("viewerToday — pay stays with the founder (regression)", () => {
  it("carries no pounds, R or hours", () => {
    const e = estimateToday(comps({ made: madeByLine([item({ fridgeQty: 150 })]) }), settings, extra);
    const json = JSON.stringify(viewerToday(e));
    for (const k of ["valueCredited", "labourCost", "ratio", "paidHours"]) expect(json).not.toContain(`"${k}"`);
    expect(json).not.toContain("£");
    expect(viewerToday(e).estimatePct).toBe(e.estimatePct);
    expect(viewerToday(e).packsByLine).toEqual({ "Line A": 150 });
  });
});
