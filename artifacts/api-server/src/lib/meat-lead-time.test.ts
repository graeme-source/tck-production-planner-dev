import { describe, it, expect } from "vitest";
import { meatLeadMinutes, meatLeadWarning } from "./meat-lead-time";

describe("meatLeadMinutes — cook + process", () => {
  it("adds the two (Beef Mince 25 + 6 = 31)", () => {
    expect(meatLeadMinutes(25, 6)).toEqual({ minutes: 31, missing: null });
    expect(meatLeadMinutes(210, 30)).toEqual({ minutes: 240, missing: null });
  });
  it("a process time of 0 is a real answer", () => {
    expect(meatLeadMinutes(30, 0)).toEqual({ minutes: 30, missing: null });
  });
  it("uses what it has and says what's missing", () => {
    expect(meatLeadMinutes(30, null)).toEqual({ minutes: 30, missing: "process" });
    expect(meatLeadMinutes(null, 40)).toEqual({ minutes: 40, missing: "cook" });
    expect(meatLeadMinutes(null, null)).toEqual({ minutes: null, missing: "both" });
  });
  it("ignores nonsense values", () => {
    expect(meatLeadMinutes(-5, Number.NaN)).toEqual({ minutes: null, missing: "both" });
  });
});

describe("meatLeadWarning", () => {
  it("only warns when something is missing", () => {
    expect(meatLeadWarning("Carnizone", "Beef Mince", meatLeadMinutes(25, 6))).toBeNull();
    expect(meatLeadWarning("Carnizone", "Chicken", meatLeadMinutes(30, null))).toMatch(/no process time set — counted as 0/);
  });
});
