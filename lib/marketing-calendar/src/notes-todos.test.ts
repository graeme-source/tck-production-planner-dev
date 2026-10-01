import { describe, it, expect } from "vitest";
import {
  NOTE_EVENT_TYPE, decideTodoViewers, filingEvents, initials, isNoteEvent, noteDatesValid, parseIdList,
  todoCalendarDay, todosInRange, campaignForDate, buildEmailSections,
} from "./index";

describe("notes are not phases", () => {
  const phase = { id: 1, startDate: "2026-10-01", endDate: "2026-10-31", type: "campaign" };
  const note = { id: 2, startDate: "2026-10-10", endDate: "2026-10-10", type: NOTE_EVENT_TYPE };

  it("knows a note by its type (client or server shape)", () => {
    expect(isNoteEvent(note)).toBe(true);
    expect(isNoteEvent({ eventType: "note" })).toBe(true);
    expect(isNoteEvent(phase)).toBe(false);
  });

  it("drops notes before emails are filed, so a note never takes an email", () => {
    // Without the filter the note (started later, shorter) would win the day.
    expect(campaignForDate("2026-10-10", [phase, note])?.id).toBe(2);
    expect(campaignForDate("2026-10-10", filingEvents([phase, note]))?.id).toBe(1);
  });

  it("a note is one day", () => {
    expect(noteDatesValid({ startDate: "2026-10-10", endDate: "2026-10-10" })).toBe(true);
    expect(noteDatesValid({ startDate: "2026-10-10", endDate: "2026-10-11" })).toBe(false);
  });
});

describe("decideTodoViewers — whose to-dos the calendar may show", () => {
  const calendarPeopleIds = [9, 24];

  it("everyone gets their own", () => {
    expect(decideTodoViewers({ viewerId: 24, viewerIsFounder: false, requestedIds: [], calendarPeopleIds }))
      .toEqual({ ok: true, userIds: [24] });
    expect(decideTodoViewers({ viewerId: 24, viewerIsFounder: false, requestedIds: [24], calendarPeopleIds }))
      .toEqual({ ok: true, userIds: [24] });
  });

  it("a non-founder can NEVER see another person's to-dos", () => {
    const r = decideTodoViewers({ viewerId: 24, viewerIsFounder: false, requestedIds: [9], calendarPeopleIds });
    expect(r.ok).toBe(false);
    // Not even the founder's, and not by sneaking their own id in too.
    expect(decideTodoViewers({ viewerId: 9, viewerIsFounder: false, requestedIds: [9, 2], calendarPeopleIds: [2, 9, 24] }).ok).toBe(false);
  });

  it("the founder may switch on a calendar person's to-dos", () => {
    expect(decideTodoViewers({ viewerId: 2, viewerIsFounder: true, requestedIds: [9], calendarPeopleIds }))
      .toEqual({ ok: true, userIds: [2, 9] });
  });

  it("…but not someone who can't see the calendar", () => {
    expect(decideTodoViewers({ viewerId: 2, viewerIsFounder: true, requestedIds: [9, 40], calendarPeopleIds }).ok).toBe(false);
  });

  it("parses the id list from the query string", () => {
    expect(parseIdList("9, 24,9,x,-1,0")).toEqual([9, 24]);
    expect(parseIdList(undefined)).toEqual([]);
  });
});

describe("to-dos on calendar days", () => {
  it("sits on the due day, else the scheduled day, else nowhere", () => {
    expect(todoCalendarDay({ dueDate: "2026-10-05", scheduledFor: "2026-10-02" })).toEqual({ date: "2026-10-05", kind: "due" });
    expect(todoCalendarDay({ dueDate: null, scheduledFor: "2026-10-02" })).toEqual({ date: "2026-10-02", kind: "scheduled" });
    expect(todoCalendarDay({ dueDate: null, scheduledFor: null })).toBeNull();
  });

  it("keeps the calendar day as stored — no timezone shift around the clock change", () => {
    // BST ends 25 Oct 2026; a DATE is already the London day.
    expect(todoCalendarDay({ dueDate: "2026-10-25", scheduledFor: null })?.date).toBe("2026-10-25");
  });

  it("filters to the range by the day it shows on", () => {
    const todos = [
      { id: 1, dueDate: "2026-10-05", scheduledFor: null },
      { id: 2, dueDate: "2026-11-05", scheduledFor: "2026-10-20" }, // due outside → not shown
      { id: 3, dueDate: null, scheduledFor: "2026-10-31" },
      { id: 4, dueDate: null, scheduledFor: null },
    ];
    expect(todosInRange(todos, "2026-10-01", "2026-10-31").map(t => [t.id, t.date, t.dateKind]))
      .toEqual([[1, "2026-10-05", "due"], [3, "2026-10-31", "scheduled"]]);
  });

  it("initials for someone else's chip", () => {
    expect(initials("Tommy Noithip")).toBe("TN");
    expect(initials("Lorna")).toBe("L");
    expect(initials(null)).toBe("?");
  });
});

describe("List view extras (notes + to-dos on their day)", () => {
  it("slot into the phase running that day, ahead of that day's emails, and never into a note", () => {
    const phase = { id: 1, startDate: "2026-10-01", endDate: "2026-10-31" };
    const sections = buildEmailSections({
      campaigns: [phase],
      planned: [{ id: 5, sendDate: "2026-10-10", sendTime: "09:00", klaviyoCampaignId: null }],
      klaviyo: [],
      extras: [{ date: "2026-10-10", key: "note-7" }, { date: "2026-11-02", key: "todo-3" }],
      today: "2026-10-01",
      showPast: false,
    });
    expect(sections[0].items.map(i => i.kind)).toEqual(["extra", "planned"]);
    expect(sections[1].campaign).toBeNull();
    expect(sections[1].items[0]).toMatchObject({ kind: "extra", date: "2026-11-02" });
  });
});
