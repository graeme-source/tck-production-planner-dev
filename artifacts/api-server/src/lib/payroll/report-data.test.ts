import { describe, it, expect } from "vitest";
import {
  assemblePayroll, parseContractDays, leaverDate,
  type PayrollInput, type PayrollShiftInput,
} from "./report-data";
import { payPeriodFor } from "./period";

// Fixtures shaped like TCK's Planday responses (see lib/planday-payroll.test.ts
// and lib/holiday-summary.ts for the checked shapes). Unpaid breaks carry
// NEGATIVE amounts and durations in hours.
const period = payPeriodFor("2026-10-10"); // 25 Sep – 24 Oct 2026

let nextId = 1;
function shift(employeeId: number, date: string, startHm: string, endHm: string, rate: number, opts: {
  unpaidBreakH?: number; type?: string; id?: number;
} = {}): PayrollShiftInput {
  const start = `${date}T${startHm}:00`;
  const end = `${date}T${endHm}:00`;
  const clock = (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
  const brk = opts.unpaidBreakH ?? 0;
  return {
    id: opts.id ?? nextId++,
    employeeId,
    date,
    start,
    end,
    salary: clock * rate,
    breaks: brk ? [{ duration: brk, amount: -brk * rate, isPaid: false }] : [],
    wage: { rate, type: opts.type ?? "HourlyRate" },
  };
}

const ACC_HOLIDAY = 501;
const ACC_SICK = 502;
const ACC_SICK_UNPAID = 503;

function baseInput(over: Partial<PayrollInput> = {}): PayrollInput {
  return {
    period,
    payrollRows: [
      // Chris: two full days, 07:00–16:30 with 50 min unpaid (35 lunch + 15).
      shift(101, "2026-09-29", "07:00", "16:30", 12.75, { unpaidBreakH: 50 / 60 }),
      shift(101, "2026-10-01", "07:00", "16:30", 12.75, { unpaidBreakH: 50 / 60 }),
      // Tommy: one short shift, no breaks.
      shift(102, "2026-10-20", "09:00", "13:00", 12.21),
    ],
    employees: [
      { id: 101, firstName: "Chris", lastName: "Coles", hiredDate: "2024-03-01" },
      { id: 102, firstName: "Tommy", lastName: "Reed", hiredDate: "2026-10-06" },
    ],
    deactivatedEmployees: [
      { id: 103, firstName: "Ana", lastName: "Lopes", hiredDate: "2025-01-10", deactivationDate: "2026-10-03" },
      { id: 104, firstName: "Old", lastName: "Leaver", hiredDate: "2023-01-10", deactivationDate: "2026-05-01" },
    ],
    absenceRecords: [],
    absenceAccounts: [
      { id: ACC_HOLIDAY, name: "Standard Hourly Accrual" },
      { id: ACC_SICK, name: "Sick" },
      { id: ACC_SICK_UNPAID, name: "SICK - unpaid" },
    ],
    contracts: [
      { plandayEmployeeId: 101, status: "ok", rule: "41.25 Hours", ruleDescription: "5 days a week" },
      { plandayEmployeeId: 102, status: "ok", rule: "16.5 Hours per week", ruleDescription: null },
    ],
    appUsers: [
      { id: 11, name: "Chris Coles", plandayEmployeeId: 101, isActive: true, issuedWeeklyHours: null, issuedAt: null, uploaded: null },
      { id: 12, name: "Tommy Reed", plandayEmployeeId: 102, isActive: true, issuedWeeklyHours: "24.75", issuedAt: "2026-10-01", uploaded: null },
    ],
    ...over,
  };
}

describe("assemblePayroll — people, hours and pay", () => {
  it("pays paid hours × rate (unpaid breaks off), not Planday's salary", () => {
    const d = assemblePayroll(baseInput());
    const chris = d.people.find(p => p.plandayEmployeeId === 101)!;
    const paid = 2 * (9.5 - 50 / 60);
    expect(chris.hours).toBeCloseTo(paid, 2);
    expect(chris.grossPay).toBeCloseTo(paid * 12.75, 2);
    expect(chris.shifts).toBe(2);
    expect(chris.hourlyRate).toBe(12.75);
    expect(chris.salaried).toBe(false);
    expect(chris.appUserId).toBe(11);
    expect(chris.name).toBe("Chris Coles");
  });

  it("totals add up across people", () => {
    const d = assemblePayroll(baseInput());
    const sumPay = d.people.reduce((s, p) => s + p.grossPay, 0);
    expect(d.totals.grossPay).toBeCloseTo(sumPay, 1);
    expect(d.totals.hours).toBeCloseTo(2 * (9.5 - 50 / 60) + 4, 2);
    expect(d.period).toEqual({ from: "2026-09-25", to: "2026-10-24", label: "25 Sep – 24 Oct 2026" });
  });

  it("sorts people by name", () => {
    expect(assemblePayroll(baseInput()).people.map(p => p.name)).toEqual(["Chris Coles", "Tommy Reed"]);
  });

  it("dedupes the same shift fetched in two chunks and drops shifts outside the period", () => {
    const s = shift(101, "2026-10-02", "07:00", "15:00", 12.75, { id: 9001 });
    const d = assemblePayroll(baseInput({
      payrollRows: [s, { ...s }, shift(101, "2026-10-25", "07:00", "15:00", 12.75)],
    }));
    expect(d.people[0].shifts).toBe(1);
    expect(d.people[0].hours).toBe(8);
    expect(d.warnings.some(w => w.includes("outside"))).toBe(true);
  });

  it("uses the latest rate and warns when it changed mid-period", () => {
    const d = assemblePayroll(baseInput({
      payrollRows: [
        shift(101, "2026-09-26", "07:00", "15:00", 12.21),
        shift(101, "2026-10-14", "07:00", "15:00", 12.75),
      ],
    }));
    expect(d.people[0].hourlyRate).toBe(12.75);
    expect(d.warnings.some(w => w.includes("rate changed") && w.includes("Chris Coles"))).toBe(true);
  });

  it("flags salaried people", () => {
    const d = assemblePayroll(baseInput({
      payrollRows: [shift(101, "2026-10-01", "09:00", "17:00", 0, { type: "MonthlySalary" })],
    }));
    expect(d.people[0].salaried).toBe(true);
    expect(d.people[0].hourlyRate).toBeNull();
    expect(d.warnings.some(w => w.includes("salaried"))).toBe(true);
  });

  it("names unlinked Planday people and warns", () => {
    const d = assemblePayroll(baseInput({ payrollRows: [shift(999, "2026-10-01", "09:00", "12:00", 12.21)] }));
    expect(d.people[0].name).toBe("Planday employee 999");
    expect(d.people[0].appUserId).toBeNull();
    expect(d.warnings.some(w => w.includes("isn't linked"))).toBe(true);
  });

  it("names a deactivated person who worked in the period", () => {
    const d = assemblePayroll(baseInput({ payrollRows: [shift(103, "2026-09-30", "07:00", "15:00", 12.21)] }));
    expect(d.people[0].name).toBe("Ana Lopes");
  });

  it("warns about active linked people with no approved shifts", () => {
    const d = assemblePayroll(baseInput({ payrollRows: [shift(101, "2026-10-01", "07:00", "15:00", 12.75)] }));
    expect(d.warnings.some(w => w.startsWith("Tommy Reed has no approved shifts"))).toBe(true);
  });

  it("an empty month is zero, not an error", () => {
    const d = assemblePayroll(baseInput({ payrollRows: [] }));
    expect(d.people).toEqual([]);
    expect(d.totals).toEqual({ hours: 0, grossPay: 0, productionHours: 0, productionPay: 0, officeHours: 0, officePay: 0, holidayHours: 0, holidayPay: 0 });
  });
});

describe("assemblePayroll — contracted hours and days", () => {
  it("uses the shared source order: issued contract beats the Planday rule", () => {
    const d = assemblePayroll(baseInput());
    const tommy = d.people.find(p => p.plandayEmployeeId === 102)!;
    expect(tommy.contractHoursPerWeek).toBe(24.75); // issued, not 16.5 from Planday
    const chris = d.people.find(p => p.plandayEmployeeId === 101)!;
    expect(chris.contractHoursPerWeek).toBe(41.25); // Planday rule
  });

  it("reads days a week off the Planday rule when it states them", () => {
    const d = assemblePayroll(baseInput());
    expect(d.people.find(p => p.plandayEmployeeId === 101)!.contractDaysPerWeek).toBe(5);
    expect(d.people.find(p => p.plandayEmployeeId === 102)!.contractDaysPerWeek).toBeNull();
  });

  it("falls back to an uploaded contract, and warns when Planday couldn't be reached", () => {
    const d = assemblePayroll(baseInput({
      contracts: [{ plandayEmployeeId: 101, status: "unreachable", rule: null }],
      appUsers: [{ id: 11, name: "Chris Coles", plandayEmployeeId: 101, isActive: true, issuedWeeklyHours: null, issuedAt: null,
        uploaded: { confirmedHours: "37.5", extractedHours: "37", issueDate: "2023-01-01" } }],
      payrollRows: [shift(101, "2026-10-01", "07:00", "15:00", 12.75)],
    }));
    expect(d.people[0].contractHoursPerWeek).toBe(37.5);
    expect(d.warnings.some(w => w.includes("contract rules"))).toBe(true);
  });

  it("no source → null", () => {
    const d = assemblePayroll(baseInput({ contracts: [], appUsers: [], payrollRows: [shift(101, "2026-10-01", "07:00", "15:00", 12.75)] }));
    expect(d.people[0].contractHoursPerWeek).toBeNull();
    expect(d.people[0].contractDaysPerWeek).toBeNull();
  });

  it("parseContractDays", () => {
    expect(parseContractDays("41.25 Hours")).toBeNull();
    expect(parseContractDays("41.25 Hours", "5 days a week")).toBe(5);
    expect(parseContractDays("3-day week")).toBe(3);
    expect(parseContractDays("4 Days")).toBe(4);
    expect(parseContractDays("10 days")).toBeNull();
  });
});

describe("assemblePayroll — sickness", () => {
  it("lists sick days by absence-account name containing 'sick', any case", () => {
    const d = assemblePayroll(baseInput({
      absenceRecords: [
        { id: 1, employeeId: 101, status: "Approved", registrations: [
          { date: "2026-10-06T00:00:00", account: { id: ACC_SICK } },
          { date: "2026-10-07T00:00:00", account: { id: ACC_SICK } },
        ] },
        { id: 2, employeeId: 102, status: "Approved", registrations: [{ date: "2026-10-12", account: { id: ACC_SICK_UNPAID }, hours: 4 }] },
        // Holiday is not sickness.
        { id: 3, employeeId: 101, status: "Approved", registrations: [{ date: "2026-10-15", account: { id: ACC_HOLIDAY } }] },
      ],
    }));
    expect(d.sick.map(s => [s.name, s.date, s.hours])).toEqual([
      ["Chris Coles", "2026-10-06", null],
      ["Chris Coles", "2026-10-07", null],
      ["Tommy Reed", "2026-10-12", 4],
    ]);
    expect(d.sick[0].contractHoursPerWeek).toBe(41.25);
    expect(d.sick[0].contractDaysPerWeek).toBe(5);
  });

  it("skips declined records and days outside the period; counts pending with a warning", () => {
    const d = assemblePayroll(baseInput({
      absenceRecords: [
        { id: 1, employeeId: 101, status: "Declined", registrations: [{ date: "2026-10-06", account: { id: ACC_SICK } }] },
        { id: 2, employeeId: 101, status: "Approved", registrations: [{ date: "2026-09-24", account: { id: ACC_SICK } }] },
        { id: 3, employeeId: 102, status: "Requested", registrations: [{ date: "2026-10-24", account: { id: ACC_SICK } }] },
      ],
    }));
    expect(d.sick.map(s => [s.plandayEmployeeId, s.date])).toEqual([[102, "2026-10-24"]]);
    expect(d.warnings.some(w => w.includes("not approved"))).toBe(true);
  });

  it("merges duplicate records for the same day and warns on unknown accounts", () => {
    const d = assemblePayroll(baseInput({
      absenceRecords: [
        { id: 1, employeeId: 101, status: "Approved", registrations: [{ date: "2026-10-06", account: { id: ACC_SICK }, hours: 4 }] },
        { id: 2, employeeId: 101, status: "Approved", registrations: [{ date: "2026-10-06", account: { id: ACC_SICK }, hours: 4.25 }] },
        { id: 3, employeeId: 101, status: "Approved", registrations: [{ date: "2026-10-08", account: { id: 777 } }] },
      ],
    }));
    expect(d.sick).toHaveLength(1);
    expect(d.sick[0].hours).toBe(8.25);
    expect(d.warnings.some(w => w.includes("777"))).toBe(true);
  });

  it("lists no Planday leavers, and no leaver warnings, when leavers are added by hand", () => {
    const d = assemblePayroll(baseInput({ listLeavers: false, deactivatedEmployees: null }));
    expect(d.leavers).toEqual([]);
    expect(d.warnings.some(w => /leaver|deactivated/i.test(w))).toBe(false);
  });

  // Regression (Graeme, 26 Oct 2026): Tommy's sick day was a rota shift
  // re-typed "Sick" with no absence record, and the report said 0 sick days.
  it("counts rota shifts whose shift type is sick, once per day", () => {
    const d = assemblePayroll(baseInput({
      shiftTypes: [{ id: 9, name: "Sick Leave" }, { id: 10, name: "Holiday (with Pay)" }, { id: 11, name: "Normal" }],
      rotaShifts: [
        { id: 900, employeeId: 102, date: "2026-10-12", startDateTime: "2026-10-12T07:00:00", endDateTime: "2026-10-12T15:30:00", shiftTypeId: 9 },
        { id: 901, employeeId: 101, date: "2026-10-13", shiftTypeId: 10 },
        { id: 902, employeeId: 101, date: "2026-10-14", shiftTypeId: 11 },
        { id: 903, employeeId: 102, date: "2026-09-20", shiftTypeId: 9 }, // before the period
        { id: 904, employeeId: 101, date: "2026-10-06", shiftTypeId: 9 }, // same day as an absence
      ],
      absenceRecords: [{ id: 1, employeeId: 101, status: "Approved", registrations: [{ date: "2026-10-06", account: { id: ACC_SICK }, hours: 7 }] }],
    }));
    expect(d.sick.map(s => [s.name, s.date, s.hours])).toEqual([
      ["Chris Coles", "2026-10-06", 7],
      ["Tommy Reed", "2026-10-12", 8.5],
    ]);
  });
});

describe("assemblePayroll — joiners and leavers", () => {
  it("joiners by hire date in the period; leavers by deactivation date in the period", () => {
    const d = assemblePayroll(baseInput());
    expect(d.joiners).toEqual([{ plandayEmployeeId: 102, appUserId: 12, name: "Tommy Reed", date: "2026-10-06" }]);
    expect(d.leavers).toEqual([{ plandayEmployeeId: 103, appUserId: null, name: "Ana Lopes", date: "2026-10-03" }]);
  });

  it("accepts hiredFrom (single-record name) as well as hiredDate", () => {
    const d = assemblePayroll(baseInput({
      employees: [{ id: 105, firstName: "New", lastName: "Starter", hiredFrom: "2026-09-25T00:00:00" }],
    }));
    expect(d.joiners.map(j => [j.name, j.date])).toEqual([["New Starter", "2026-09-25"]]);
  });

  it("reads other leaving-date field names and warns when none is given", () => {
    expect(leaverDate({ id: 1, dateTimeDeactivated: "2026-10-01T10:00:00Z" })).toBe("2026-10-01");
    const d = assemblePayroll(baseInput({
      deactivatedEmployees: [
        { id: 106, firstName: "Sam", lastName: "Gone", terminationDate: "2026-10-24" },
        { id: 107, firstName: "No", lastName: "Date" },
      ],
    }));
    expect(d.leavers.map(l => l.name)).toEqual(["Sam Gone"]);
    expect(d.warnings.some(w => w.includes("no leaving date") && w.includes("No Date"))).toBe(true);
  });

  it("says leavers couldn't be checked when deactivated employees didn't load", () => {
    const d = assemblePayroll(baseInput({ deactivatedEmployees: null }));
    expect(d.leavers).toEqual([]);
    expect(d.warnings.some(w => w.includes("leavers can't be listed"))).toBe(true);
  });

  it("warns when Planday gave no hire dates at all", () => {
    const d = assemblePayroll(baseInput({
      employees: [{ id: 101, firstName: "Chris", lastName: "Coles" }],
      deactivatedEmployees: [],
    }));
    expect(d.warnings.some(w => w.includes("no hire dates"))).toBe(true);
  });

  it("warns when two app users share one Planday id, preferring the active one", () => {
    const d = assemblePayroll(baseInput({
      appUsers: [
        { id: 20, name: "Chris (old)", plandayEmployeeId: 101, isActive: false, issuedWeeklyHours: null, issuedAt: null, uploaded: null },
        { id: 11, name: "Chris Coles", plandayEmployeeId: 101, isActive: true, issuedWeeklyHours: null, issuedAt: null, uploaded: null },
      ],
    }));
    expect(d.people.find(p => p.plandayEmployeeId === 101)!.appUserId).toBe(11);
    expect(d.warnings.some(w => w.includes("both linked"))).toBe(true);
  });
});

/** A registration as live Planday sends it: hours as an Hours cost on the account. */
const reg = (date: string, account: number, hours: number) => ({ date, account: { id: account, costs: [{ unit: { type: "Hours" }, value: hours }] } });

describe("assemblePayroll — holiday (Graeme, 2026-10-27: holiday hours weren't paid)", () => {
  it("adds approved holiday hours × the hourly rate to hours and gross pay", () => {
    const d = assemblePayroll(baseInput({
      absenceRecords: [{ id: 10, employeeId: 101, status: "Approved", registrations: [reg("2026-10-08", ACC_HOLIDAY, 8.25), reg("2026-10-09", ACC_HOLIDAY, 8.25)] }],
    }));
    const chris = d.people.find(p => p.plandayEmployeeId === 101)!;
    const worked = 2 * (9.5 - 50 / 60);
    expect(chris.holidayHours).toBe(16.5);
    expect(chris.holidayPay).toBeCloseTo(16.5 * 12.75, 2);
    expect(chris.hours).toBeCloseTo(worked + 16.5, 2);
    expect(chris.grossPay).toBeCloseTo((worked + 16.5) * 12.75, 1);
    expect(d.totals.holidayHours).toBe(16.5);
    expect(d.totals.grossPay).toBeCloseTo(d.people.reduce((n, p) => n + p.grossPay, 0), 1);
  });

  it("someone on holiday all period still appears, with a warning when there's no rate to use", () => {
    const d = assemblePayroll(baseInput({
      payrollRows: [shift(101, "2026-09-29", "07:00", "15:00", 12.75)],
      absenceRecords: [{ id: 11, employeeId: 102, status: "Approved", registrations: [reg("2026-10-08", ACC_HOLIDAY, 4)] }],
    }));
    const tommy = d.people.find(p => p.plandayEmployeeId === 102)!;
    expect(tommy.holidayHours).toBe(4);
    expect(tommy.holidayPay).toBeNull();
    expect(d.warnings.some(w => w.includes("Tommy Reed") && w.includes("holiday") && w.includes("by hand"))).toBe(true);
    expect(d.warnings.some(w => w.includes("Tommy Reed has no approved shifts"))).toBe(false);
  });

  it("pending holiday isn't paid (warned); sickness and declined records aren't holiday", () => {
    const d = assemblePayroll(baseInput({
      absenceRecords: [
        { id: 12, employeeId: 101, status: "Pending", registrations: [reg("2026-10-08", ACC_HOLIDAY, 8.25)] },
        { id: 13, employeeId: 101, status: "Declined", registrations: [reg("2026-10-09", ACC_HOLIDAY, 8.25)] },
        { id: 14, employeeId: 101, status: "Approved", registrations: [reg("2026-10-10", ACC_SICK, 8.25)] },
      ],
    }));
    expect(d.people.find(p => p.plandayEmployeeId === 101)!.holidayHours).toBe(0);
    expect(d.warnings.some(w => w.includes("holiday request") && w.includes("not approved"))).toBe(true);
    // Live data's sick hours come from the account's Hours cost too.
    expect(d.sick.map(s => s.hours)).toEqual([8.25]);
  });
});

describe("assemblePayroll — office work below the line (Graeme, 2026-10-27)", () => {
  const positions = [
    { id: 1, name: "Builder 1", sectionId: 10 },
    { id: 2, name: "Media", sectionId: 20 },
    { id: 3, name: "Production planning", sectionId: 20 },
    { id: 4, name: "Cleaner", sectionId: null },
  ];
  const sections = [{ id: 10, name: "Production" }, { id: 20, name: "Office" }];
  const at = (s: PayrollShiftInput, positionId: number | null): PayrollShiftInput => ({ ...s, positionId });

  it("splits shifts in a non-production section out, by position, without changing the total", () => {
    const d = assemblePayroll(baseInput({
      positions, sections,
      payrollRows: [
        at(shift(101, "2026-09-29", "07:00", "15:00", 12.75), 1),
        at(shift(101, "2026-09-30", "09:00", "13:00", 12.75), 2),
        at(shift(101, "2026-10-01", "09:00", "11:00", 12.75), 3),
        at(shift(101, "2026-10-02", "09:00", "10:00", 12.75), 2),
      ],
    }));
    const chris = d.people[0];
    expect(chris.productionHours).toBe(8);
    expect(chris.officeHours).toBe(7);
    expect(chris.office).toEqual([
      { work: "Media", hours: 5, pay: 63.75 },
      { work: "Production planning", hours: 2, pay: 25.5 },
    ]);
    expect(chris.productionPay + chris.officePay).toBeCloseTo(chris.grossPay, 2);
    expect(d.totals.officePay).toBe(89.25);
    expect(d.totals.productionPay + d.totals.officePay + d.totals.holidayPay).toBeCloseTo(d.totals.grossPay, 2);
  });

  it("no position, or a position with no section, counts as production; unsectioned ones are named", () => {
    const d = assemblePayroll(baseInput({
      positions, sections,
      payrollRows: [at(shift(101, "2026-09-29", "07:00", "15:00", 12.75), null), at(shift(101, "2026-09-30", "07:00", "09:00", 12.75), 4)],
    }));
    expect(d.people[0].officeHours).toBe(0);
    expect(d.people[0].productionHours).toBe(10);
    expect(d.warnings.some(w => w.includes("Cleaner") && w.includes("section"))).toBe(true);
  });

  it("without positions/sections everything is production, as before", () => {
    const d = assemblePayroll(baseInput());
    expect(d.totals.officeHours).toBe(0);
    expect(d.totals.productionHours).toBe(d.totals.hours);
  });
});
