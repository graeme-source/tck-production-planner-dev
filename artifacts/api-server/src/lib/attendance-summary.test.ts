import { describe, it, expect } from "vitest";
import { summariseAttendance, rollingWindowStart, ATTENDANCE_POLICY } from "./attendance-summary";
import type { ClassifiedShift } from "./absence-spells";

const sh = (date: string, typeName: string | null = null): ClassifiedShift => ({ date, typeName });
const TODAY = "2026-09-25";

describe("rollingWindowStart", () => {
  it("is exactly 12 months: the day after the same date last year", () => {
    expect(rollingWindowStart("2026-09-25")).toBe("2025-09-26");
  });
  it("clamps month ends and leap days", () => {
    expect(rollingWindowStart("2024-02-29")).toBe("2023-03-01");
    expect(rollingWindowStart("2026-03-31", 1)).toBe("2026-03-01");
  });
});

describe("summariseAttendance", () => {
  it("counts sickness instances, not days", () => {
    const s = summariseAttendance([
      sh("2026-09-01", "Sick Leave"), sh("2026-09-02", "Sick - paid"), sh("2026-09-03"),
      sh("2026-09-10", "Sick Leave"),
    ], TODAY);
    expect(s).toMatchObject({ sickInstances: 2, sickDays: 3 });
  });

  it("four sickness instances in 12 months reach the trigger", () => {
    const shifts: ClassifiedShift[] = [];
    for (const m of ["01", "03", "05", "07"]) shifts.push(sh(`2026-${m}-05`, "Sick Leave"), sh(`2026-${m}-06`));
    const s = summariseAttendance(shifts, TODAY);
    expect(s.sickInstances).toBe(ATTENDANCE_POLICY.sickInstances);
    expect(s.triggers.sickness).toBe(true);
  });

  it("instances older than 12 months drop out of the window", () => {
    const s = summariseAttendance([
      sh("2025-09-20", "Sick Leave"), sh("2025-09-21"),
      sh("2026-02-01", "Sick Leave"), sh("2026-02-02"),
    ], TODAY);
    expect(s.sickInstances).toBe(1);
  });

  it("six lates reach the trigger; five don't", () => {
    const five = [1, 2, 3, 4, 5].map(d => sh(`2026-08-0${d}`, "Arrived late"));
    expect(summariseAttendance(five, TODAY).triggers.lates).toBe(false);
    const six = [...five, sh("2026-08-06", "Arrived late")];
    expect(summariseAttendance(six, TODAY)).toMatchObject({ lates: 6, triggers: { lates: true } });
  });

  it("other absences get their own count and never feed the sickness trigger", () => {
    const shifts: ClassifiedShift[] = [];
    for (const m of ["01", "03", "05", "07", "08"]) shifts.push(sh(`2026-${m}-05`, "Dependants Leave"), sh(`2026-${m}-06`));
    const s = summariseAttendance(shifts, TODAY);
    expect(s).toMatchObject({ sickInstances: 0, otherAbsenceDays: 5, otherAbsenceSpells: 5, triggers: { sickness: false } });
  });

  it("holiday is not absence at all", () => {
    const s = summariseAttendance([sh("2026-09-01", "Holiday (with Pay)")], TODAY);
    expect(s).toMatchObject({ sickDays: 0, otherAbsenceDays: 0, lates: 0 });
  });
});
