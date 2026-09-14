import { describe, it, expect } from "vitest";
import { isLateName, isAbsenceReasonName, isSickName, countSickInstances } from "./attendance-classify";

// Regression for the 2026-09-14 report bug: holiday accrual accounts were
// rolling into "Total Absent" (and Planday's broken pagination multiplied
// them 201×). These names are TCK's real Planday shift types and accounts.
describe("isAbsenceReasonName", () => {
  it("counts sickness, paid or unpaid", () => {
    expect(isAbsenceReasonName("Sick Leave")).toBe(true);
    expect(isAbsenceReasonName("Sick - paid")).toBe(true);
    expect(isAbsenceReasonName("Sick - unpaid")).toBe(true);
  });

  it("counts unexplained absence and non-holiday leave", () => {
    expect(isAbsenceReasonName("Absent")).toBe(true);
    expect(isAbsenceReasonName("Dependants Leave")).toBe(true);
    expect(isAbsenceReasonName("Emergency Leave")).toBe(true);
  });

  it("never counts holiday, in any spelling", () => {
    expect(isAbsenceReasonName("Holiday (with Pay)")).toBe(false);
    expect(isAbsenceReasonName("Holiday Leave")).toBe(false); // holiday wins over leave
  });

  it("never counts holiday accrual accounts", () => {
    expect(isAbsenceReasonName("Standard Hourly Accrual")).toBe(false);
    expect(isAbsenceReasonName("Standard Hourly Accrual - Carry over")).toBe(false);
    expect(isAbsenceReasonName("Fixed Full Time")).toBe(false);
    expect(isAbsenceReasonName("Fixed 3 Days")).toBe(false);
  });

  it("never counts non-absence shift types", () => {
    expect(isAbsenceReasonName("Meeting")).toBe(false);
    expect(isAbsenceReasonName("Training")).toBe(false);
    expect(isAbsenceReasonName("Arrived late")).toBe(false);
    expect(isAbsenceReasonName(undefined)).toBe(false);
  });
});

describe("isLateName", () => {
  it("matches the late shift type and nothing else", () => {
    expect(isLateName("Arrived late")).toBe(true);
    expect(isLateName("Sick Leave")).toBe(false);
    expect(isLateName(undefined)).toBe(false);
  });
});

describe("isSickName", () => {
  it("matches every sickness variant, nothing else", () => {
    expect(isSickName("Sick Leave")).toBe(true);
    expect(isSickName("Sick - paid")).toBe(true);
    expect(isSickName("Sick - unpaid")).toBe(true);
    expect(isSickName("Dependants Leave")).toBe(false);
    expect(isSickName(undefined)).toBe(false);
  });
});

describe("countSickInstances", () => {
  it("no sick days is zero instances", () => {
    expect(countSickInstances([], ["2026-09-01"])).toBe(0);
  });

  it("Mon-Wed off sick, back Thursday, is ONE instance", () => {
    expect(countSickInstances(
      ["2026-09-07", "2026-09-08", "2026-09-09"],
      ["2026-09-10", "2026-09-11"],
    )).toBe(1);
  });

  it("sick Friday, weekend off, sick Monday is still one instance", () => {
    expect(countSickInstances(
      ["2026-09-11", "2026-09-14"],
      ["2026-09-09", "2026-09-10", "2026-09-15"],
    )).toBe(1);
  });

  it("a worked shift between sick days splits the instance", () => {
    expect(countSickInstances(
      ["2026-09-07", "2026-09-09"],
      ["2026-09-08"],
    )).toBe(2);
  });

  it("10 days across three separated runs is three instances", () => {
    expect(countSickInstances(
      [
        "2026-08-03", "2026-08-04", "2026-08-05",             // run 1 (3 days)
        "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", // run 2 (4 days)
        "2026-09-01", "2026-09-02", "2026-09-03",             // run 3 (3 days)
      ],
      ["2026-08-06", "2026-08-10", "2026-08-24", "2026-08-25"],
    )).toBe(3);
  });

  it("duplicate and unsorted dates don't double-count", () => {
    expect(countSickInstances(
      ["2026-09-08", "2026-09-07", "2026-09-08"],
      [],
    )).toBe(1);
  });
});
