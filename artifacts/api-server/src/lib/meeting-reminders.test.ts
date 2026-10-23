import { describe, it, expect } from "vitest";
import { reminderShowsOn, orderReminders, remindersForDate, cleanReminderText } from "./meeting-reminders";

const r = (id: number, startsOn: string, removedOn: string | null, createdAt: string) => ({ id, startsOn, removedOn, createdAt });

describe("reminderShowsOn", () => {
  it("shows every day from the day it was added until removed", () => {
    const x = r(1, "2026-10-23", null, "2026-10-23T09:00:00Z");
    expect(reminderShowsOn(x, "2026-10-22")).toBe(false);
    expect(reminderShowsOn(x, "2026-10-23")).toBe(true);
    expect(reminderShowsOn(x, "2026-10-24")).toBe(true);
    expect(reminderShowsOn(x, "2026-12-01")).toBe(true);
  });
  it("is gone from the day it was removed onwards, but still on earlier days", () => {
    const x = r(1, "2026-10-20", "2026-10-23", "2026-10-20T09:00:00Z");
    expect(reminderShowsOn(x, "2026-10-22")).toBe(true);
    expect(reminderShowsOn(x, "2026-10-23")).toBe(false);
    expect(reminderShowsOn(x, "2026-10-24")).toBe(false);
  });
});

describe("orderReminders / remindersForDate", () => {
  it("lists oldest first, ties broken by id", () => {
    const rows = [
      r(3, "2026-10-21", null, "2026-10-22T08:00:00Z"),
      r(1, "2026-10-20", null, "2026-10-20T08:00:00Z"),
      r(2, "2026-10-20", null, "2026-10-20T08:00:00Z"),
    ];
    expect(orderReminders(rows).map(x => x.id)).toEqual([1, 2, 3]);
  });
  it("keeps only the live ones for the day", () => {
    const rows = [
      r(1, "2026-10-20", null, "2026-10-20T08:00:00Z"),
      r(2, "2026-10-20", "2026-10-22", "2026-10-20T09:00:00Z"),
      r(3, "2026-10-24", null, "2026-10-24T08:00:00Z"),
    ];
    expect(remindersForDate(rows, "2026-10-23").map(x => x.id)).toEqual([1]);
  });
});

describe("cleanReminderText", () => {
  it("trims, collapses whitespace and drops pasted list markers", () => {
    expect(cleanReminderText("  - Fire alarm test   at 11 ")).toBe("Fire alarm test at 11");
    expect(cleanReminderText("2. Aprons on\nfor visitors")).toBe("Aprons on for visitors");
    expect(cleanReminderText("• Bins out")).toBe("Bins out");
  });
  it("returns null for nothing worth saving", () => {
    expect(cleanReminderText("   ")).toBeNull();
    expect(cleanReminderText("- ")).toBeNull();
    expect(cleanReminderText(null)).toBeNull();
  });
});
