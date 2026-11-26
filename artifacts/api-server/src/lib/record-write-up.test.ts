import { describe, it, expect } from "vitest";
import type { ReportNote } from "@workspace/performance-review";
import { noteCount, notesForWriteUp, writeUpSystem } from "./record-write-up";

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
      "## Objectives and agreements from their last review (say how they've gone, if the notes show it)",
      "- [2026-05-01 Objective (Performance appraisal)] Be on time every shift",
      "",
      "## Notes since then, oldest first",
      "- [2026-07-01 Feedback] Great with new starters",
      "- [2026-10-02 Note] Late twice / last week",
    ]);
    expect(noteCount({ fromLastReview: [obj], list: [obj, note(2, "2026-07-01", "note", "x")] })).toBe(2);
  });
  it("asks for behaviour not character, everything kept, nothing added", () => {
    const s = writeUpSystem("Grant");
    expect(s).toContain("KEEP EVERYTHING");
    expect(s).toContain("BEHAVIOUR, NOT CHARACTER");
    expect(s).toContain("ADD NOTHING");
    expect(s).toContain("Your objectives");
  });
});
