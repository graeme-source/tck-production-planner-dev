import { describe, it, expect } from "vitest";
import {
  buildPersonTimeline, filterTimeline, timelineCounts, withinWindow, lengthOfService,
  meetingDate, spellsWithoutForm, type TimelineSpell,
} from "./person-timeline";

const spell = (start: string, end: string, over: Partial<TimelineSpell> = {}): TimelineSpell => ({
  start, end, days: 1, types: ["Sick Leave"], sickness: true, returned: true,
  formId: null, formStatus: null, formState: "needed", ...over,
});
const form = (id: number, absenceStart: string, absenceEnd: string | null = null) => ({ id, absenceStart, absenceEnd });
const meeting = (id: number, scheduledFor: string | null, heldAt: string | null = null) => ({ id, scheduledFor, heldAt });
const note = (id: number, createdAt: string) => ({ id, createdAt });

const timeline = buildPersonTimeline({
  spells: [
    spell("2026-09-14", "2026-09-14", { types: ["Dependants Leave"], sickness: false }),
    spell("2026-08-17", "2026-08-17", { formId: 6, formStatus: "complete", formState: "signed" }),
  ],
  lates: [{ date: "2026-09-11", label: "Arrived late" }],
  forms: [form(6, "2026-08-17", "2026-08-17"), form(9, "2026-03-02", "2026-03-03")],
  meetings: [meeting(1, "2026-10-01"), meeting(2, "2026-09-14")],
  looseNotes: [note(5, "2026-09-14T10:00:00Z"), note(7, "2025-01-10T09:00:00Z")],
});

describe("buildPersonTimeline", () => {
  it("merges everything newest first, future meetings on top", () => {
    expect(timeline.map(e => e.key)).toEqual([
      "m-1",          // booked for 1 Oct
      "m-2", "n-5", "a-2026-09-14", // same day: meeting, note, then the absence
      "l-2026-09-11-0",
      "a-2026-08-17",
      "f-9",          // hand-recorded form with no detected spell
      "n-7",
    ]);
  });

  it("a form sitting on a detected spell rides on the spell, not twice", () => {
    const a = timeline.find(e => e.key === "a-2026-08-17");
    expect(a && a.kind === "absence" && a.form?.id).toBe(6);
    expect(timeline.some(e => e.key === "f-6")).toBe(false);
  });
});

describe("filters", () => {
  it("each chip shows its own kinds; absences count as attendance AND return to work", () => {
    expect(filterTimeline(timeline, "attendance").map(e => e.kind)).toEqual(["absence", "late", "absence"]);
    expect(filterTimeline(timeline, "rtw").map(e => e.key)).toEqual(["a-2026-09-14", "a-2026-08-17", "f-9"]);
    expect(filterTimeline(timeline, "meetings").map(e => e.key)).toEqual(["m-1", "m-2"]);
    expect(filterTimeline(timeline, "notes").map(e => e.key)).toEqual(["n-5", "n-7"]);
    expect(timelineCounts(timeline)).toEqual({ all: 8, attendance: 3, rtw: 3, meetings: 2, notes: 2 });
  });
});

describe("withinWindow", () => {
  it("drops what's older than the window, keeps the future", () => {
    expect(withinWindow(timeline, "2025-09-26").map(e => e.key)).not.toContain("n-7");
    expect(withinWindow(timeline, "2026-09-20").map(e => e.key)).toEqual(["m-1"]);
  });
});

describe("helpers", () => {
  it("a meeting sits on its booked date, else when it was held", () => {
    expect(meetingDate(meeting(1, null, "2026-09-01T14:00:00Z"))).toBe("2026-09-01");
  });
  it("spells without a form can still have one started", () => {
    expect(spellsWithoutForm([spell("a", "a"), spell("b", "b", { formId: 3 })]).map(s => s.start)).toEqual(["a"]);
  });
  it("length of service reads like a person would say it", () => {
    expect(lengthOfService("2022-03-23", "2026-09-25")).toBe("4 years 6 months");
    expect(lengthOfService("2026-09-11", "2026-09-25")).toBe("2 weeks");
    expect(lengthOfService("2025-09-25", "2026-09-25")).toBe("1 year");
    expect(lengthOfService("2026-10-06", "2026-09-25")).toBe("Starts 6 Oct 2026");
    expect(lengthOfService(null, "2026-09-25")).toBeNull();
  });
});
