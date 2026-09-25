import { describe, it, expect } from "vitest";
import {
  presetRange, londonToday, fmtHm, fmtHours, fmtSigned, fmtDifference, leaveSummary, weekNote, weekTone,
  type WeekHours,
} from "./hours-worked-view";

const week = (over: Partial<WeekHours>): WeekHours => ({
  weekStart: "2026-09-07", weekEnd: "2026-09-13", paidHours: 40, shifts: 5,
  leaveDays: { holiday: 0, sickness: 0, absence: 0 }, status: "counted", vsContract: 0, ...over,
});

describe("presetRange", () => {
  it("the last N full weeks plus this week so far", () => {
    expect(presetRange("4w", "2026-09-25")).toEqual({ from: "2026-08-24", to: "2026-09-25" });
    expect(presetRange("3m", "2026-09-25")).toEqual({ from: "2026-06-22", to: "2026-09-25" });
    expect(presetRange("6m", "2026-09-21")).toEqual({ from: "2026-03-23", to: "2026-09-21" });
  });
  it("londonToday uses the London date, not UTC", () => {
    expect(londonToday(new Date("2026-09-24T23:30:00Z"))).toBe("2026-09-25");
  });
});

describe("formatting", () => {
  it("fmtHm reads hours as hours and minutes", () => {
    expect(fmtHm(9.158)).toBe("9h 09m");
    expect(fmtHm(9 + 50 / 60)).toBe("9h 50m");
    expect(fmtHm(-1.5)).toBe("−1h 30m");
    expect(fmtHm(null)).toBe("—");
  });
  it("fmtHours and fmtSigned: one decimal, real minus sign", () => {
    expect(fmtHours(44.959)).toBe("45.0 h");
    expect(fmtSigned(3.24)).toBe("+3.2");
    expect(fmtSigned(-4)).toBe("−4.0");
    expect(fmtSigned(0.02)).toBe("0.0");
  });
  it("fmtDifference says over or under contract", () => {
    expect(fmtDifference(3.2, "over")).toBe("+3.2 h/week over contract");
    expect(fmtDifference(-4, "under")).toBe("−4.0 h/week under contract");
    expect(fmtDifference(0.3, "on")).toBe("On contract");
    expect(fmtDifference(null, null)).toBe("—");
  });
});

describe("weeks", () => {
  it("leaveSummary names each kind of leave", () => {
    expect(leaveSummary({ holiday: 3, sickness: 1, absence: 0 })).toBe("3 days holiday, 1 day sick");
    expect(leaveSummary({ holiday: 0, sickness: 0, absence: 0 })).toBe("");
  });
  it("weekNote explains every week left out of the average", () => {
    expect(weekNote(week({}))).toBeNull();
    expect(weekNote(week({ status: "leave", leaveDays: { holiday: 5, sickness: 0, absence: 0 } }))).toBe("5 days holiday — not counted");
    expect(weekNote(week({ status: "in_progress" }))).toMatch(/not over yet/);
    expect(weekNote(week({ status: "part_week" }))).toMatch(/Part week/);
    expect(weekNote(week({ status: "before_start" }))).toMatch(/Before they started/);
  });
  it("weekTone colours counted weeks against the contract", () => {
    expect(weekTone(week({ vsContract: 3 }), 40)).toBe("over");
    expect(weekTone(week({ vsContract: -3 }), 40)).toBe("under");
    expect(weekTone(week({ vsContract: 0.2 }), 40)).toBe("on");
    expect(weekTone(week({ vsContract: null }), null)).toBe("no_contract");
    expect(weekTone(week({ status: "leave" }), 40)).toBe("excluded");
  });
});
