import { describe, it, expect } from "vitest";
import type { ReportNote } from "@workspace/performance-review";
import { noteCount, notesForWriteUp, replaceableNoteIds, writeUpSystem } from "./record-write-up";

const note = (id: number, date: string, kind: string, body: string, extra: Partial<ReportNote> = {}): ReportNote => ({
  id, entryId: null, entryTitle: null, entryDate: null, kind, title: null, body, date, shared: false, sharedWithHr: false,
  author: "Graeme Carter", dueDate: null, done: false, ...extra,
} as ReportNote);

describe("record write-up", () => {
  it("lists last review's objectives first, then the rest oldest first, each once", () => {
    const obj = note(1, "2026-05-01", "objective", "Be on time every shift", { entryTitle: "Performance appraisal" });
    const text = notesForWriteUp({
      fromLastReview: [obj],
      list: [note(3, "2026-10-02", "note", "Late twice\nlast week"), obj, note(2, "2026-07-01", "feedback", "Great with new starters")],
    });
    expect(text.split("\n")).toEqual([
      "## Objectives and agreements from their last review (put each under its topic in To work on, with how it's gone if the notes say)",
      "- [2026-05-01 Objective (Performance appraisal)] Be on time every shift",
      "",
      "## Notes since then, oldest first",
      "- [2026-07-01 Feedback] Great with new starters",
      "- [2026-10-02 Note] Late twice / last week",
    ]);
    expect(noteCount({ fromLastReview: [obj], list: [obj, note(2, "2026-07-01", "note", "x")] })).toBe(2);
  });
  it("asks for short dated bullets: every point kept, nothing added, behaviour not character", () => {
    const s = writeUpSystem("Grant");
    expect(s).toContain("KEEP EVERY POINT, ONCE");
    expect(s).toContain("combine similar or overlapping points into one bullet");
    expect(s).toContain("TOPIC: DETAIL");
    expect(s).toContain("NO SEPARATE OBJECTIVES");
    expect(s).toContain("DATES ON EVENTS");
    expect(s).toContain("BEHAVIOUR, NOT CHARACTER");
    expect(s).toContain("ADD NOTHING");
    // Positives first, the constructive middle, personal positives last.
    expect(s.indexOf("\nStart with\n")).toBeLessThan(s.indexOf("\nTo work on\n"));
    expect(s.indexOf("\nTo work on\n")).toBeLessThan(s.indexOf("\nFinish with\n"));
  });
  it("replaces only the loose private notes it read — never meeting notes, shared notes or last review's objectives", () => {
    const obj = note(1, "2026-05-01", "objective", "On time", { entryId: 9 });
    const meeting = note(2, "2026-09-15", "feedback", "Good", { entryId: 10 });
    const shared = note(3, "2026-10-01", "note", "Told them", { shared: true });
    const hr = note(4, "2026-10-02", "note", "For Lorna", { sharedWithHr: true });
    const loose = note(5, "2026-10-03", "note", "Late");
    expect(replaceableNoteIds({ fromLastReview: [obj], list: [loose, obj, meeting, shared, hr, loose] })).toEqual([4, 5]);
  });
});
