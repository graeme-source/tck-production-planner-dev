import { describe, it, expect } from "vitest";
import { groupRecordNotes } from "./employee-record-grouping";

const note = (id: number, kind: string, meetingId: number | null, doneAt: string | null = null) =>
  ({ id, kind, meetingId, doneAt });

describe("groupRecordNotes", () => {
  it("keeps open objectives in the agreed list even when attached to a meeting", () => {
    const g = groupRecordNotes([note(1, "objective", 10)], new Set([10]));
    expect(g.openObjectives.map(n => n.id)).toEqual([1]);
    expect(g.byMeeting.size).toBe(0);
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
