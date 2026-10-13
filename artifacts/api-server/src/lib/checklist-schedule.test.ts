import { describe, expect, it } from "vitest";
import { templateMatchesDay } from "./checklist-schedule";

// Same answers the inline copy in routes/checklists.ts gave before it moved
// onto lib/recurrence. 2026-10-12 is a Monday.
const MON = "2026-10-12", TUE = "2026-10-13", SAT = "2026-10-17";

describe("checklist schedules on the shared recurrence engine", () => {
  it("daily (and anything unknown) is every day", () => {
    expect(templateMatchesDay({ schedule: "daily", scheduleDays: null }, SAT)).toBe(true);
    expect(templateMatchesDay({ schedule: "something-new", scheduleDays: null }, SAT)).toBe(true);
  });
  it("weekly uses the stored days, Monday when none are stored", () => {
    expect(templateMatchesDay({ schedule: "weekly", scheduleDays: null }, MON)).toBe(true);
    expect(templateMatchesDay({ schedule: "weekly", scheduleDays: null }, TUE)).toBe(false);
    expect(templateMatchesDay({ schedule: "weekly", scheduleDays: '["tuesday"]' }, TUE)).toBe(true);
    expect(templateMatchesDay({ schedule: "weekly", scheduleDays: '["tuesday"]' }, MON)).toBe(false);
  });
  it("specific days with none stored is never", () => {
    expect(templateMatchesDay({ schedule: "specific_days", scheduleDays: null }, MON)).toBe(false);
    expect(templateMatchesDay({ schedule: "specific_days", scheduleDays: '["monday","saturday"]' }, SAT)).toBe(true);
  });
  it("periodic is every 4 weeks from the anchor's week", () => {
    const t = { schedule: "periodic", scheduleDays: '["wednesday"]', scheduleAnchorDate: "2026-10-12" };
    expect(templateMatchesDay(t, "2026-10-14")).toBe(true);
    expect(templateMatchesDay(t, "2026-10-21")).toBe(false);
    expect(templateMatchesDay(t, "2026-11-11")).toBe(true);
    expect(templateMatchesDay(t, "2026-09-16")).toBe(true);
  });
  it("periodic without an anchor cycles from the creation week", () => {
    const t = { schedule: "periodic", scheduleDays: null, createdAt: new Date("2026-10-14T09:00:00Z") };
    expect(templateMatchesDay(t, MON)).toBe(true);
    expect(templateMatchesDay(t, "2026-10-19")).toBe(false);
    expect(templateMatchesDay(t, "2026-11-09")).toBe(true);
  });
  it("periodic with neither anchor nor creation date is always on its day", () => {
    expect(templateMatchesDay({ schedule: "periodic", scheduleDays: null }, "2026-10-19")).toBe(true);
  });
});
