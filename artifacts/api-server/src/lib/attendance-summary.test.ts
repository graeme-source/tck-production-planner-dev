import { describe, it, expect } from "vitest";
import { summariseAttendance, rollingWindowStart, policyTriggerReview, ATTENDANCE_POLICY } from "./attendance-summary";
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

  it("dates each instance: a sickness run by its first day, every late shift", () => {
    const s = summariseAttendance([
      sh("2026-09-01", "Sick Leave"), sh("2026-09-02", "Sick Leave"), sh("2026-09-03"),
      sh("2026-09-10", "Sick Leave"), sh("2026-09-15", "Arrived late"), sh("2026-08-04", "Arrived late"),
    ], TODAY);
    expect(s.instanceDates).toEqual({ sickness: ["2026-09-01", "2026-09-10"], lates: ["2026-08-04", "2026-09-15"] });
  });
});

describe("policyTriggerReview", () => {
  const eight = ["03", "04", "05", "06", "07", "08", "09"].map(m => sh(`2026-${m}-07`, "Arrived late")).concat(sh("2026-09-20", "Arrived late"));
  it("a review held after the trigger was reached, no lates since → handled", () => {
    const s = summariseAttendance(eight, TODAY);
    const review = { source: "entry" as const, id: 1, date: "2026-09-22", held: true, covers: ["sickness", "lates"] as const };
    expect(policyTriggerReview(s, [review])).toMatchObject({ sickness: null, lates: { state: "handled", count: 8, reachedOn: "2026-08-07" } });
    expect(policyTriggerReview(s, [])).toMatchObject({ lates: { state: "due" } });
  });
});
