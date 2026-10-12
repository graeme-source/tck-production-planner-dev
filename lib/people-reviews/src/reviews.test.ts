import { describe, expect, it } from "vitest";
import {
  isReview, reviewDay, startingMeetingStatus, meetingTodoDate, meetingStatusChange, writeUpRows, meetingWrittenUp,
  ownRecordView, recordTimelineEvents, type Classification, type TimelineEntry,
} from "./index";

describe("a review is an entry with a meeting status", () => {
  it("knows a review from a plain record entry", () => {
    expect(isReview({ meetingStatus: "booked" })).toBe(true);
    expect(isReview({ meetingStatus: "cancelled" })).toBe(true);
    expect(isReview({ meetingStatus: null })).toBe(false);
  });
  it("sits on its meeting day, else the entry date", () => {
    expect(reviewDay({ entryDate: "2026-10-01", meetingDate: "2026-10-12" })).toBe("2026-10-12");
    expect(reviewDay({ entryDate: "2026-10-01", meetingDate: null })).toBe("2026-10-01");
  });
  it("starts booked for today or later, held for a day gone or when said so", () => {
    expect(startingMeetingStatus("2026-10-12", "2026-10-12")).toBe("booked");
    expect(startingMeetingStatus("2026-10-20", "2026-10-12")).toBe("booked");
    expect(startingMeetingStatus("2026-10-11", "2026-10-12")).toBe("held");
    expect(startingMeetingStatus("2026-10-20", "2026-10-12", true)).toBe("held");
    expect(startingMeetingStatus(null, "2026-10-12")).toBe("booked");
  });
  it("drops the booker's to-do when a review is cancelled", () => {
    expect(meetingTodoDate("cancelled", "2026-10-20")).toBeNull();
    expect(meetingTodoDate("booked", "2026-10-20")).toBe("2026-10-20");
    expect(meetingTodoDate("held", null)).toBeNull();
  });
  it("stamps held_at the first time only, and says what changed", () => {
    expect(meetingStatusChange("booked", "held", null)).toEqual({ stampHeldAt: true, message: "Meeting changed from booked to held" });
    expect(meetingStatusChange("held", "cancelled", "2026-10-12T10:00:00Z").stampHeldAt).toBe(false);
    expect(meetingStatusChange("cancelled", "held", "2026-10-12T10:00:00Z").stampHeldAt).toBe(false);
    expect(meetingStatusChange(null, "booked", null).message).toBe("Meeting booked");
    expect(meetingStatusChange("booked", null, null).message).toBe("Meeting changed from booked to no meeting");
  });
});

describe("writing a review up", () => {
  it("saves feedback, then objectives, then notes — blanks dropped", () => {
    const rows = writeUpRows({
      feedback: "  Speed is up  ",
      objectives: [{ title: "Output", body: "Two trays an hour", dueDate: "2026-11-01" }, { title: "", body: "  " }, { title: "Tidy bench", body: "" }],
      notes: "",
    });
    expect(rows).toEqual([
      { kind: "feedback", title: null, body: "Speed is up", dueDate: null },
      { kind: "objective", title: "Output", body: "Two trays an hour", dueDate: "2026-11-01" },
      { kind: "objective", title: null, body: "Tidy bench", dueDate: null },
    ]);
  });
  it("is empty when nothing was written", () => {
    expect(writeUpRows({ feedback: " ", objectives: [{ title: "", body: "" }], notes: null })).toEqual([]);
  });
});

describe("has a meeting been written up (Needs attention)", () => {
  const base = { meetingStatus: "held" as const, outcome: null, status: "closed", writeUpCount: 0 };
  it("a held review with nothing written is not", () => expect(meetingWrittenUp(base)).toBe(false));
  it("a booked one with nothing written is not, even if closed", () => expect(meetingWrittenUp({ ...base, meetingStatus: "booked" })).toBe(false));
  it("a write-up note or an outcome counts", () => {
    expect(meetingWrittenUp({ ...base, writeUpCount: 1 })).toBe(true);
    expect(meetingWrittenUp({ ...base, outcome: "Passed" })).toBe(true);
  });
  it("a cancelled one needs nothing", () => expect(meetingWrittenUp({ ...base, meetingStatus: "cancelled" })).toBe(true));
  it("an entry with no meeting status keeps the old rule (closed = done)", () => {
    expect(meetingWrittenUp({ ...base, meetingStatus: null })).toBe(true);
    expect(meetingWrittenUp({ ...base, meetingStatus: null, status: "open" })).toBe(false);
  });
});

describe("the employee's own view", () => {
  const reviews = [
    { id: 1, entryDate: "2026-09-15", meetingDate: "2026-09-15", meetingStatus: "held" as const, heldAt: "2026-09-17T13:07:00Z" },
    { id: 2, entryDate: "2026-10-12", meetingDate: "2026-10-12", meetingStatus: "booked" as const, heldAt: null },
    { id: 3, entryDate: "2026-10-01", meetingDate: "2026-10-01", meetingStatus: "held" as const, heldAt: null },
  ];
  const note = (id: number, entryId: number | null, kind: string, doneAt: string | null = null) =>
    ({ id, entryId, kind, doneAt, createdAt: `2026-10-0${id}T10:00:00Z` });

  it("shows only reviews they have something to read in, newest first", () => {
    const v = ownRecordView(reviews, [note(1, 1, "feedback"), note(2, 3, "note")]);
    expect(v.reviews.map(r => r.entryId)).toEqual([3, 1]);
    expect(v.reviews[0]).toMatchObject({ date: "2026-10-01", status: "held" });
  });
  it("never lists a review with nothing shared — not even that it exists", () => {
    expect(ownRecordView(reviews, []).reviews).toEqual([]);
  });
  it("keeps loose notes, and notes for a review it doesn't know, as loose", () => {
    const v = ownRecordView(reviews, [note(4, null, "feedback"), note(5, 99, "note")]);
    expect(v.loose.map(n => n.id)).toEqual([5, 4]);
  });
  it("agreed = open objectives from the latest review that set any, plus loose ones", () => {
    const v = ownRecordView(reviews, [
      note(1, 1, "objective"), note(2, 3, "objective"), note(3, 3, "objective", "2026-10-05T00:00:00Z"), note(6, null, "objective"),
    ]);
    expect(v.agreed.map(n => n.id)).toEqual([6, 2]);
  });
});

describe("timeline events for reviews", () => {
  const classes: Classification[] = [{ id: 1, label: "Performance appraisal", sortOrder: 10, fieldSets: [], evidence: null, active: true }];
  const entry = (over: Partial<TimelineEntry>): TimelineEntry => ({
    id: 7, classificationId: 1, entryDate: "2026-10-12", title: "", status: "closed", stageId: null, warningExpiresOn: null,
    warningWithdrawnAt: null, closedOn: null, meetingType: null, meetingDate: "2026-10-12", meetingTime: null, meetingStatus: "booked", ...over,
  });
  it("a review with no ACAS type still has its meeting, called Review", () => {
    const ev = recordTimelineEvents([entry({})], classes, [], "2026-10-12");
    expect(ev.find(e => e.kind === "meeting")?.title).toBe("Review · Performance appraisal");
  });
  it("a cancelled review has no meeting event", () => {
    const ev = recordTimelineEvents([entry({ meetingStatus: "cancelled" })], classes, [], "2026-10-12");
    expect(ev.some(e => e.kind === "meeting")).toBe(false);
  });
});
