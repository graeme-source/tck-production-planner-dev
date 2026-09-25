import { describe, it, expect } from "vitest";
import {
  nextProductionDay, productionDayFor, isRestDay, weekStart, addDaysIso, weeklyOnCostMultipliers, labourByProductionDay,
  type PayrollRowInput, type RotaShiftInput, type LabourInputs,
} from "./team-efficiency-labour";

const PRODUCTION = 13937;
const OFFICE = 13503;
const positions = [
  { id: 1, name: "Builder 1", sectionId: PRODUCTION },
  { id: 2, name: "Dough Prep", sectionId: PRODUCTION },
  { id: 3, name: "Frying", sectionId: PRODUCTION },
  { id: 4, name: "Scheduling", sectionId: OFFICE },
  { id: 5, name: "Event Team Member", sectionId: null },
];
const shiftTypes = [{ id: 10, name: "Training" }, { id: 11, name: "Arrived late" }, { id: 12, name: "Holiday (with Pay)" }];
const planDates = ["2026-09-18", "2026-09-21", "2026-09-22"]; // Fri, Mon, Tue

// 8 h paid at £10: 07:00–15:50 with a 50-minute unpaid break (salary is clock time).
function row(id: number, date: string, positionId: number | null, employeeId = id): PayrollRowInput {
  return {
    id, employeeId, date: `${date}T00:00:00`, positionId,
    salary: (8 + 50 / 60) * 10,
    start: `${date}T07:00:00`, end: `${date}T15:50:00`,
    breaks: [{ duration: 50 / 60, amount: -(50 / 60) * 10, isPaid: false }],
  };
}
const approved = (r: PayrollRowInput, shiftTypeId: number | null = null): RotaShiftInput => ({
  id: r.id, employeeId: r.employeeId, date: r.date, status: "Approved", positionId: r.positionId, shiftTypeId,
});

function inputs(p: Partial<LabourInputs>): LabourInputs {
  return {
    payroll: [], rota: [], positions, shiftTypes, productionSectionId: PRODUCTION,
    sortedPlanDates: planDates, nonDispatchDays: new Set(), linePositions: { "Line B": ["frying", "Breading"] },
    multipliers: new Map(), fallbackMultiplier: 1.25, today: "2026-09-25", staleAfterDays: 14, ...p,
  };
}

describe("dates", () => {
  it("finds the next production day on or after a date", () => {
    expect(nextProductionDay("2026-09-20", planDates)).toBe("2026-09-21"); // Sunday → Monday
    expect(nextProductionDay("2026-09-21", planDates)).toBe("2026-09-21");
    expect(nextProductionDay("2026-09-23", planDates)).toBeNull();
  });
  it("rolls rest-day shifts forward, but never a weekday with no plan", () => {
    const none = new Set<string>();
    expect(isRestDay("2026-09-20", none)).toBe(true);       // Sunday
    expect(isRestDay("2026-08-31", new Set(["2026-08-31"]))).toBe(true); // bank holiday
    expect(isRestDay("2026-09-23", none)).toBe(false);
    expect(productionDayFor("2026-09-20", planDates, none)).toBe("2026-09-21");  // Sunday prep → Monday
    expect(productionDayFor("2026-09-19", planDates, none)).toBe("2026-09-21");  // Saturday → Monday
    expect(productionDayFor("2026-09-18", planDates, none)).toBe("2026-09-18");
    // Sunday + bank-holiday Monday → Tuesday
    expect(productionDayFor("2026-08-30", ["2026-08-28", "2026-09-01"], new Set(["2026-08-31"]))).toBe("2026-09-01");
    // An ordinary Friday with no plan belongs to no production day…
    expect(productionDayFor("2026-05-22", ["2026-05-21", "2026-05-27"], new Set(["2026-05-25"]))).toBeNull();
    // …and nor does the Sunday before a weekday with no plan.
    expect(productionDayFor("2026-07-05", ["2026-07-03", "2026-07-07"], none)).toBeNull();
  });
  it("keys weeks by their Monday", () => {
    expect(weekStart("2026-09-20")).toBe("2026-09-14"); // Sunday
    expect(weekStart("2026-09-21")).toBe("2026-09-21");
    expect(addDaysIso("2026-09-01", -1)).toBe("2026-08-31");
  });
});

describe("weeklyOnCostMultipliers", () => {
  it("adds holiday accrual, NI over each person's weekly threshold less the allowance, and pension", () => {
    const s = { holidayAccrual: 0.1, niRate: 0.15, niWeeklyThreshold: 100, employmentAllowanceAnnual: 0, pensionRate: 0.03 };
    // One person, £500 pay in the week → £550 with holiday; NI = (550 − 100) × 0.15.
    const rows = [{ ...row(1, "2026-09-21", 1), salary: 500, breaks: [] }];
    const m = weeklyOnCostMultipliers(rows, s).get("2026-09-21")!;
    const ni = ((550 - 100) * 0.15) / 550;
    expect(m).toBeCloseTo(1.1 * (1 + ni + 0.03), 6);
  });
});

describe("labourByProductionDay", () => {
  it("counts only Production-section, productive shifts, with breaks taken off pay", () => {
    const rows = [row(1, "2026-09-21", 1), row(2, "2026-09-21", 4), row(3, "2026-09-21", 5), row(4, "2026-09-21", null)];
    const out = labourByProductionDay(inputs({ payroll: rows, rota: rows.map(r => approved(r)) }));
    const mon = out.get("2026-09-21")!;
    expect(mon.labourCostTotal).toBeCloseTo(80 * 1.25, 6); // 8 paid hours × £10 × fallback multiplier
    expect(mon.paidHours).toBeCloseTo(8, 6);
    expect(mon.headcount).toBe(1);
  });

  it("drops training / holiday shift types even in a production position", () => {
    const rows = [row(1, "2026-09-21", 1), row(2, "2026-09-21", 1), row(3, "2026-09-21", 1)];
    const rota = [approved(rows[0], 10), approved(rows[1], 12), approved(rows[2], 11)];
    const out = labourByProductionDay(inputs({ payroll: rows, rota }));
    expect(out.get("2026-09-21")!.headcount).toBe(1); // only "Arrived late" counts
  });

  it("falls back to the mirror's shift type when the rota didn't return the shift", () => {
    const rows = [row(1, "2026-09-21", 1)];
    const out = labourByProductionDay(inputs({ payroll: rows, rota: [], shiftTypeByShiftId: new Map([[1, 10]]) }));
    expect(out.get("2026-09-21")).toBeUndefined();
  });

  it("charges Sunday dough prep to Monday's production", () => {
    const rows = [row(1, "2026-09-20", 2), row(2, "2026-09-21", 1)];
    const out = labourByProductionDay(inputs({ payroll: rows, rota: rows.map(r => approved(r)) }));
    expect(out.get("2026-09-21")!.headcount).toBe(2);
    expect(out.has("2026-09-20")).toBe(false);
  });

  it("uses the week's own multiplier for each shift", () => {
    const rows = [row(1, "2026-09-18", 1)];
    const out = labourByProductionDay(inputs({ payroll: rows, rota: rows.map(r => approved(r)), multipliers: new Map([["2026-09-14", 1.3]]) }));
    expect(out.get("2026-09-18")!.labourCostTotal).toBeCloseTo(80 * 1.3, 6);
  });

  it("tracks line-only positions' labour by line, matching names case-insensitively", () => {
    const rows = [row(1, "2026-09-22", 3), row(2, "2026-09-22", 1)];
    const out = labourByProductionDay(inputs({ payroll: rows, rota: rows.map(r => approved(r)) }));
    const line = out.get("2026-09-22")!.lineLabour;
    expect(Object.keys(line)).toEqual(["Line B"]);
    expect(line["Line B"]).toBeCloseTo(80 * 1.25, 6);
  });

  it("holds a recent day back while a productive shift is unapproved", () => {
    const rows = [row(1, "2026-09-22", 1)];
    const rota: RotaShiftInput[] = [
      approved(rows[0]),
      { id: 99, employeeId: 7, date: "2026-09-22", status: "PunchclockStarted", positionId: 1, shiftTypeId: null },
      { id: 98, employeeId: null, date: "2026-09-22", status: "Open", positionId: 1, shiftTypeId: null },
      { id: 97, employeeId: 8, date: "2026-09-22", status: "Assigned", positionId: 4, shiftTypeId: null },
    ];
    const out = labourByProductionDay(inputs({ payroll: rows, rota }));
    expect(out.get("2026-09-22")!.pendingShifts).toBe(1);
  });

  it("leaves old never-approved shifts out instead of blanking the day forever", () => {
    const rota: RotaShiftInput[] = [{ id: 99, employeeId: 7, date: "2026-09-18", status: "Assigned", positionId: 1, shiftTypeId: null }];
    const out = labourByProductionDay(inputs({ rota, today: "2026-10-10" }));
    expect(out.get("2026-09-18")!.pendingShifts).toBe(0);
    expect(out.get("2026-09-18")!.ignoredUnapproved).toBe(1);
  });
});
