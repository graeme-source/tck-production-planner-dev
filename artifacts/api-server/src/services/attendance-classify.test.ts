import { describe, it, expect } from "vitest";
import { isLateName, isAbsenceReasonName } from "./attendance-classify";

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
