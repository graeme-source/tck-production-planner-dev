import { describe, it, expect } from "vitest";
import {
  leaveKindForShiftType, leaveKindForAbsenceAccount, toHoursShift, classifyForEmployees,
  buildHoursReport, typicalTime, isoWeekday, standingFor, sortTeamRows, payrollBlocks, resolveHoursRange,
  type ClassifiedHoursShift, type HoursShift,
} from "./hours-worked";

/** A shift on `date` from `start` to `end` ("HH:MM"), with `unpaidMin` of unpaid break. */
function shift(date: string, start: string, end: string, unpaidMin = 0, extra: Partial<ClassifiedHoursShift> = {}): ClassifiedHoursShift {
  return {
    ...toHoursShift({
      id: Math.floor(Math.random() * 1e9), employeeId: 1, date,
      start: `${date}T${start}:00`, end: `${date}T${end}:00`,
      breaks: unpaidMin ? [{ duration: unpaidMin / 60, amount: -5, isPaid: false }] : [],
    }),
    leave: null,
    ...extra,
  };
}

describe("leave classification", () => {
  it("shift types: holiday, sickness and absence reasons are leave; training/meeting/late are worked", () => {
    expect(leaveKindForShiftType("Holiday (with Pay)")).toBe("holiday");
    expect(leaveKindForShiftType("Sick Leave")).toBe("sickness");
    expect(leaveKindForShiftType("Sick - paid")).toBe("sickness");
    expect(leaveKindForShiftType("Absent")).toBe("absence");
    expect(leaveKindForShiftType("Dependants Leave")).toBe("absence");
    expect(leaveKindForShiftType("Emergency Leave")).toBe("absence");
    expect(leaveKindForShiftType("Training")).toBeNull();
    expect(leaveKindForShiftType("Meeting")).toBeNull();
    expect(leaveKindForShiftType("Arrived late")).toBeNull();
    expect(leaveKindForShiftType(null)).toBeNull();
  });
  it("absence accounts are holiday unless named as sickness or another reason", () => {
    expect(leaveKindForAbsenceAccount("Standard Hourly Accrual")).toBe("holiday");
    expect(leaveKindForAbsenceAccount("Fixed Full Time")).toBe("holiday");
    expect(leaveKindForAbsenceAccount(undefined)).toBe("holiday");
    expect(leaveKindForAbsenceAccount("Sick")).toBe("sickness");
    expect(leaveKindForAbsenceAccount("Dependants leave")).toBe("absence");
  });
});

describe("toHoursShift", () => {
  it("paid hours take off unpaid breaks only (durations in hours)", () => {
    const s = toHoursShift({
      id: 1, employeeId: 9, date: "2026-06-29",
      start: "2026-06-29T05:15:00", end: "2026-06-29T15:35:00",
      breaks: [
        { duration: 35 / 60, amount: -8, isPaid: false },
        { duration: 10 / 60, amount: 0, isPaid: true },
      ],
    });
    expect(s.clockHours).toBeCloseTo(10 + 20 / 60, 6);
    expect(s.paidHours).toBeCloseTo(10 + 20 / 60 - 35 / 60, 6);
    expect(s.start).toBe("05:15");
    expect(s.end).toBe("15:35");
  });
  it("never carries pay across", () => {
    const row = { id: 1, employeeId: 9, date: "2026-06-29", start: "2026-06-29T05:00:00", end: "2026-06-29T06:00:00", breaks: null, salary: 123.45, wage: { rate: 12.5 } };
    const s = toHoursShift(row);
    expect(JSON.stringify(s)).not.toMatch(/salary|wage|rate|123/);
  });
});

describe("classifyForEmployees", () => {
  const payroll: HoursShift[] = [
    { id: 10, employeeId: 1, date: "2026-09-01", start: "05:00", end: "14:00", clockHours: 9, paidHours: 8.5 },
    { id: 11, employeeId: 1, date: "2026-09-02", start: "05:00", end: "14:00", clockHours: 9, paidHours: 8.5 },
    { id: 12, employeeId: 2, date: "2026-09-01", start: "06:00", end: "12:00", clockHours: 6, paidHours: 6 },
  ];
  const types = new Map([[1, "Holiday (with Pay)"], [2, "Sick Leave"], [3, "Training"]]);
  const out = classifyForEmployees({
    payroll,
    rota: [
      { id: 11, employeeId: 1, date: "2026-09-02", shiftTypeId: 1 },  // paid holiday shift in payroll
      { id: 12, employeeId: 2, date: "2026-09-01", shiftTypeId: 3 },  // training = worked
      { id: 99, employeeId: 2, date: "2026-09-03", shiftTypeId: 2 },  // unpaid sick, not in payroll
    ],
    shiftTypeNames: types,
    absences: [
      { employeeId: 1, status: "Approved", registrations: [{ date: "2026-09-07", account: { id: 500 } }, { date: "2026-09-08", account: { id: 500 } }] },
      { employeeId: 1, status: "Declined", registrations: [{ date: "2026-09-09", account: { id: 500 } }] },
    ],
    absenceAccountNames: new Map([[500, "Standard Hourly Accrual"]]),
  });
  it("marks leave-typed payroll shifts and keeps the rest as worked", () => {
    const one = out.get(1)!;
    expect(one.shifts.find(s => s.id === 10)!.leave).toBeNull();
    expect(one.shifts.find(s => s.id === 11)!.leave).toBe("holiday");
    expect(out.get(2)!.shifts[0].leave).toBeNull();
  });
  it("collects leave days from rota types and APPROVED absence records only", () => {
    expect(out.get(1)!.leaveDays.map(l => `${l.date}:${l.kind}`).sort()).toEqual([
      "2026-09-02:holiday", "2026-09-02:holiday", "2026-09-07:holiday", "2026-09-08:holiday",
    ]);
    expect(out.get(2)!.leaveDays).toEqual([{ date: "2026-09-03", kind: "sickness" }]);
  });
});

describe("buildHoursReport", () => {
  // Mon 31 Aug – Sun 27 Sep 2026: four full weeks; today is Mon 28 Sep.
  const base = { from: "2026-08-31", to: "2026-09-27", today: "2026-09-28", startedOn: null };
  const fullWeek = (monday: string, len = "15:00") => [0, 1, 2, 3, 4].map(i => {
    const d = new Date(`${monday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
    return shift(d.toISOString().slice(0, 10), "05:00", len, 50);
  });

  it("averages per shift and per counted week, and compares with the contract", () => {
    const shifts = [...fullWeek("2026-08-31"), ...fullWeek("2026-09-07"), ...fullWeek("2026-09-14"), ...fullWeek("2026-09-21", "13:00")];
    const r = buildHoursReport({ ...base, shifts, leaveDays: [], contractedHours: 40 });
    expect(r.shifts).toBe(20);
    expect(r.avgClockHours).toBeCloseTo(9.5, 2);                        // (10×15 + 8×5)/20
    expect(r.countedWeeks).toBe(4);
    // weeks: 3 × 5 × (10 − 50/60) + 5 × (8 − 50/60) = 137.5 + 35.83
    expect(r.avgPaidPerWeek).toBeCloseTo((3 * 5 * (10 - 5 / 6) + 5 * (8 - 5 / 6)) / 4, 2);
    expect(r.difference).toBeCloseTo(r.avgPaidPerWeek! - 40, 2);
    expect(r.standing).toBe("over");
    expect(r.weeks[3].vsContract).toBeCloseTo(5 * (8 - 5 / 6) - 40, 2);
    expect(r.typicalStart).toBe("05:00");
    expect(r.typicalFinish).toBe("15:00");
  });

  it("a week with holiday is marked and left out of the weekly average — not counted as under", () => {
    const shifts = [...fullWeek("2026-08-31"), ...fullWeek("2026-09-07").slice(0, 2), ...fullWeek("2026-09-14"), ...fullWeek("2026-09-21")];
    const leaveDays = [{ date: "2026-09-10", kind: "holiday" as const }, { date: "2026-09-11", kind: "holiday" as const }, { date: "2026-09-09", kind: "sickness" as const }];
    const r = buildHoursReport({ ...base, shifts, leaveDays, contractedHours: 45 });
    const w = r.weeks.find(x => x.weekStart === "2026-09-07")!;
    expect(w.status).toBe("leave");
    expect(w.leaveDays).toEqual({ holiday: 2, sickness: 1, absence: 0 });
    expect(w.vsContract).toBeNull();
    expect(r.countedWeeks).toBe(3);
    expect(r.leaveWeeks).toBe(1);
    expect(r.avgPaidPerWeek).toBeCloseTo(5 * (10 - 5 / 6), 2);
    // Per-shift figures still use every worked shift in the range.
    expect(r.shifts).toBe(17);
  });

  it("leave-typed shifts are not hours worked", () => {
    const shifts = [...fullWeek("2026-08-31"), shift("2026-09-07", "05:00", "13:00", 0, { leave: "holiday" })];
    const r = buildHoursReport({ ...base, shifts, leaveDays: [{ date: "2026-09-07", kind: "holiday" }], contractedHours: null });
    expect(r.shifts).toBe(5);
    expect(r.leaveShifts).toBe(1);
    expect(r.weeks[1].paidHours).toBe(0);
    expect(r.weeks[1].status).toBe("leave");
    expect(r.difference).toBeNull();
    expect(r.standing).toBeNull();
  });

  it("part weeks at the range edges, the week in progress and weeks before they started are excluded", () => {
    const r = buildHoursReport({
      from: "2026-09-02", to: "2026-09-24", today: "2026-09-24", startedOn: null,
      shifts: [...fullWeek("2026-08-31"), ...fullWeek("2026-09-07"), ...fullWeek("2026-09-14"), ...fullWeek("2026-09-21")],
      leaveDays: [], contractedHours: 40,
    });
    expect(r.weeks.map(w => w.status)).toEqual(["part_week", "counted", "counted", "in_progress"]);
    // Only shifts from 2 Sep count at all.
    expect(r.weeks[0].shifts).toBe(3);

    const joined = buildHoursReport({ ...base, startedOn: "2026-09-09", shifts: [...fullWeek("2026-09-14"), ...fullWeek("2026-09-21")], leaveDays: [], contractedHours: 40 });
    expect(joined.weeks.map(w => w.status)).toEqual(["before_start", "part_week", "counted", "counted"]);
    expect(joined.otherExcludedWeeks).toBe(2);
  });

  it("a week with no shifts and no leave counts as zero hours — that IS under", () => {
    const r = buildHoursReport({ ...base, shifts: [...fullWeek("2026-08-31"), ...fullWeek("2026-09-14"), ...fullWeek("2026-09-21")], leaveDays: [], contractedHours: 40 });
    expect(r.weeks[1]).toMatchObject({ status: "counted", paidHours: 0, vsContract: -40 });
  });

  it("nobody on the rota in the range has no weekly average, not zero", () => {
    const r = buildHoursReport({ ...base, shifts: [], leaveDays: [], contractedHours: 40 });
    expect(r.avgPaidPerWeek).toBeNull();
    expect(r.difference).toBeNull();
    expect(r.standing).toBeNull();
  });

  it("averages keep enough precision to read in minutes (476.2 h over 52 shifts is 9h 09m)", () => {
    // 52 shifts summing to 476.2 paid hours: 9.1577 h each on average.
    const shifts = Array.from({ length: 52 }, (_, i) => {
      const d = new Date("2026-06-29T00:00:00Z"); d.setUTCDate(d.getUTCDate() + Math.floor(i / 5) * 7 + (i % 5));
      const date = d.toISOString().slice(0, 10);
      return { ...shift(date, "05:00", "14:00"), paidHours: 476.2 / 52 };
    });
    const r = buildHoursReport({ from: "2026-06-29", to: "2026-09-13", today: "2026-09-25", startedOn: null, shifts, leaveDays: [], contractedHours: null });
    expect(r.totalPaidHours).toBeCloseTo(476.2, 1);
    expect(Math.round((r.avgPaidHours! % 1) * 60)).toBe(9);
  });

  it("weekday table: shifts, average paid hours and typical times per day", () => {
    const shifts = [shift("2026-09-03", "05:00", "16:00", 50), shift("2026-09-10", "05:30", "16:30", 50), shift("2026-09-04", "05:00", "12:00", 0)];
    const r = buildHoursReport({ ...base, shifts, leaveDays: [], contractedHours: null });
    const thu = r.weekdays.find(d => d.weekday === 4)!;
    expect(thu.shifts).toBe(2);
    expect(thu.avgPaidHours).toBeCloseTo(11 - 5 / 6, 2);
    expect(thu.typicalStart).toBe("05:15"); // median of 05:00 and 05:30
    const fri = r.weekdays.find(d => d.weekday === 5)!;
    expect(fri.avgClockHours).toBe(7);
    expect(r.weekdays.find(d => d.weekday === 6)!.avgPaidHours).toBeNull();
  });
});

describe("helpers", () => {
  it("typicalTime is the median time of day, to the nearest 5 minutes", () => {
    expect(typicalTime(["05:15", "05:20", "06:00"])).toBe("05:20");
    expect(typicalTime(["05:10", "05:20"])).toBe("05:15");
    expect(typicalTime(["05:11", "05:13", "05:14"])).toBe("05:15");
    expect(typicalTime(["15:22"])).toBe("15:20");
    expect(typicalTime([])).toBeNull();
  });
  it("isoWeekday: Monday 1 … Sunday 7", () => {
    expect(isoWeekday("2026-09-21")).toBe(1);
    expect(isoWeekday("2026-09-27")).toBe(7);
  });
  it("standing: within half an hour a week is on contract", () => {
    expect(standingFor(0.4)).toBe("on");
    expect(standingFor(-0.4)).toBe("on");
    expect(standingFor(3.2)).toBe("over");
    expect(standingFor(-4)).toBe("under");
    expect(standingFor(null)).toBeNull();
  });
});

describe("sortTeamRows", () => {
  it("biggest gap either way first, then hours without a contract, then the rest", () => {
    const rows = [
      { name: "A", avgPaidPerWeek: 40, difference: 1 },
      { name: "B", avgPaidPerWeek: 30, difference: -6 },
      { name: "C", avgPaidPerWeek: 44, difference: null },
      { name: "D", avgPaidPerWeek: null, difference: null },
      { name: "E", avgPaidPerWeek: 48, difference: 4 },
      { name: "F", avgPaidPerWeek: 20, difference: null },
    ];
    expect(sortTeamRows(rows).map(r => r.name)).toEqual(["B", "E", "A", "C", "F", "D"]);
  });
});

describe("resolveHoursRange", () => {
  it("defaults to this week and the 12 before it, ending today", () => {
    expect(resolveHoursRange({}, "2026-09-25")).toEqual({ from: "2026-06-29", to: "2026-09-25" });
  });
  it("never runs past today", () => {
    expect(resolveHoursRange({ from: "2026-09-01", to: "2026-12-01" }, "2026-09-25")).toEqual({ from: "2026-09-01", to: "2026-09-25" });
  });
  it("refuses backwards and over-long ranges", () => {
    expect(resolveHoursRange({ from: "2026-09-20", to: "2026-09-10" }, "2026-09-25")).toHaveProperty("error");
    expect(resolveHoursRange({ from: "2025-01-01" }, "2026-09-25")).toHaveProperty("error");
    expect(resolveHoursRange({ from: "2025-09-01" }, "2026-09-25")).toEqual({ from: "2025-09-01", to: "2026-09-25" });
  });
});

describe("payrollBlocks", () => {
  it("28-day blocks on a fixed grid, so different ranges share blocks", () => {
    const a = payrollBlocks("2026-06-27", "2026-09-25");
    const b = payrollBlocks("2026-08-31", "2026-09-25");
    expect(a.length).toBeGreaterThanOrEqual(4);
    for (const blk of a) {
      expect(Math.round((Date.parse(blk.to) - Date.parse(blk.from)) / 86_400_000)).toBe(27);
    }
    expect(a[0].from <= "2026-06-27").toBe(true);
    expect(a[a.length - 1].to >= "2026-09-25").toBe(true);
    // b's blocks are a subset of a's.
    const keys = new Set(a.map(x => x.from));
    expect(b.every(x => keys.has(x.from))).toBe(true);
    // Contiguous, no gaps.
    for (let i = 1; i < a.length; i++) {
      const prevEnd = new Date(`${a[i - 1].to}T00:00:00Z`); prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
      expect(prevEnd.toISOString().slice(0, 10)).toBe(a[i].from);
    }
  });
});
