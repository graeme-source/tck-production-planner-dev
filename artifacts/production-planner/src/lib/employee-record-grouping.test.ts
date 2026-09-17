import { describe, it, expect } from "vitest";
import { groupRecordNotes, currentObjectives } from "./employee-record-grouping";

const note = (id: number, kind: string, meetingId: number | null, doneAt: string | null = null) =>
  ({ id, kind, meetingId, doneAt });

describe("groupRecordNotes", () => {
  it("shows an open objective in the agreed list AND under its meeting", () => {
    // Changed 2026-09-17: this used to assert byMeeting.size === 0, i.e. the
    // objective was taken OUT of its meeting. That is the bug Graeme hit —
    // a probation meeting that set objectives appeared to have set none.
    const g = groupRecordNotes([note(1, "objective", 10)], new Set([10]));
    expect(g.openObjectives.map(n => n.id)).toEqual([1]);
    expect((g.byMeeting.get(10) ?? []).map(n => n.id)).toEqual([1]);
    expect(g.unattached).toEqual([]);
  });

  it("nests meeting write-up notes under their meeting", () => {
    const g = groupRecordNotes(
      [note(1, "feedback", 10), note(2, "note", 10), note(3, "note", null)],
      new Set([10]),
    );
    expect(g.byMeeting.get(10)?.map(n => n.id)).toEqual([1, 2]);
    expect(g.unattached.map(n => n.id)).toEqual([3]);
  });

  it("a done objective renders with its meeting, not the agreed list", () => {
    const g = groupRecordNotes([note(1, "objective", 10, "2026-09-15T10:00:00Z")], new Set([10]));
    expect(g.openObjectives).toEqual([]);
    expect(g.byMeeting.get(10)?.map(n => n.id)).toEqual([1]);
  });

  it("never loses a note whose meeting is gone — it falls back to the diary", () => {
    const g = groupRecordNotes([note(1, "feedback", 99)], new Set([10]));
    expect(g.unattached.map(n => n.id)).toEqual([1]);
    expect(g.byMeeting.size).toBe(0);
  });

  it("handles an empty record", () => {
    const g = groupRecordNotes([], new Set());
    expect(g.openObjectives).toEqual([]);
    expect(g.byMeeting.size).toBe(0);
    expect(g.unattached).toEqual([]);
  });
});

describe("objectives stay with their meeting", () => {
  const objective = { id: 1, kind: "objective", meetingId: 7, doneAt: null };
  const feedback = { id: 2, kind: "feedback", meetingId: 7, doneAt: null };

  it("REGRESSION: an open objective renders under its meeting AND in the summary", () => {
    // It used to be lifted to the top and dropped from the meeting, so a
    // probation meeting looked as though it set no objectives at all
    // (Graeme, 2026-09-17).
    const g = groupRecordNotes([objective, feedback], new Set([7]));
    expect(g.openObjectives.map(n => n.id)).toEqual([1]);
    expect((g.byMeeting.get(7) ?? []).map(n => n.id)).toEqual([1, 2]);
  });

  it("a completed objective drops out of the summary but stays in its meeting", () => {
    const done = { id: 3, kind: "objective", meetingId: 7, doneAt: "2026-09-01T00:00:00Z" };
    const g = groupRecordNotes([done], new Set([7]));
    expect(g.openObjectives).toEqual([]);
    expect((g.byMeeting.get(7) ?? []).map(n => n.id)).toEqual([3]);
  });
});

describe("currentObjectives", () => {
  const older = { id: 1, kind: "objective", meetingId: 10, doneAt: null };
  const newer = { id: 2, kind: "objective", meetingId: 20, doneAt: null };
  const alsoNewer = { id: 3, kind: "objective", meetingId: 20, doneAt: null };
  const meetings = [
    { id: 10, heldAt: "2026-03-01T10:00:00Z", scheduledFor: null },
    { id: 20, heldAt: "2026-09-15T10:00:00Z", scheduledFor: null },
  ];

  it("keeps only the objectives from the most recent meeting", () => {
    const got = currentObjectives([older, newer, alsoNewer], meetings);
    expect(got.map(o => o.id)).toEqual([2, 3]);
  });

  it("always keeps objectives written outside a meeting", () => {
    const standing = { id: 4, kind: "objective", meetingId: null, doneAt: null };
    const got = currentObjectives([older, newer, standing], meetings);
    expect(got.map(o => o.id).sort()).toEqual([2, 4]);
  });

  it("falls back to the scheduled date when a meeting was never marked held", () => {
    const m = [
      { id: 10, heldAt: null, scheduledFor: "2026-03-01" },
      { id: 20, heldAt: null, scheduledFor: "2026-09-15" },
    ];
    expect(currentObjectives([older, newer], m).map(o => o.id)).toEqual([2]);
  });

  it("breaks a date tie on the newer meeting id", () => {
    const m = [
      { id: 10, heldAt: "2026-09-15T10:00:00Z", scheduledFor: null },
      { id: 20, heldAt: "2026-09-15T10:00:00Z", scheduledFor: null },
    ];
    expect(currentObjectives([older, newer], m).map(o => o.id)).toEqual([2]);
  });

  it("keeps everything rather than hiding objectives whose meeting is missing", () => {
    expect(currentObjectives([older, newer], []).map(o => o.id)).toEqual([1, 2]);
  });
});
