import { describe, it, expect } from "vitest";
import {
  countImprovementsCompletedInWindow,
  IMPROVEMENT_DONE_STATUSES,
} from "./improvements-completed";

// A BST London day: 2026-09-17 runs 23:00 UTC (16th) → 22:59:59.999 UTC (17th).
const dayStart = new Date("2026-09-16T23:00:00.000Z");
const dayEnd = new Date("2026-09-17T22:59:59.999Z");

const row = (progressStatus: string, doneAtIso: string | null) => ({
  progressStatus,
  doneAt: doneAtIso ? new Date(doneAtIso) : null,
});

describe("countImprovementsCompletedInWindow", () => {
  it("counts complete and awaiting_approval rows done inside the window", () => {
    const rows = [
      row("complete", "2026-09-17T08:30:00Z"),
      row("awaiting_approval", "2026-09-17T14:00:00Z"),
    ];
    expect(countImprovementsCompletedInWindow(rows, dayStart, dayEnd)).toBe(2);
  });

  it("never counts ideas (submitted_for_review), even with a doneAt", () => {
    const rows = [
      row("submitted_for_review", null),
      // Shouldn't exist, but the status is what matters, not the stamp.
      row("submitted_for_review", "2026-09-17T09:00:00Z"),
    ];
    expect(countImprovementsCompletedInWindow(rows, dayStart, dayEnd)).toBe(0);
  });

  it("does not count rejected rows — the claimed completion was sent back", () => {
    const rows = [row("rejected", "2026-09-17T09:00:00Z")];
    expect(countImprovementsCompletedInWindow(rows, dayStart, dayEnd)).toBe(0);
  });

  it("buckets by the doing (doneAt), not any later approval", () => {
    // Done the day BEFORE the window — approving it today must not pull it in.
    const rows = [row("complete", "2026-09-16T15:00:00Z")];
    expect(countImprovementsCompletedInWindow(rows, dayStart, dayEnd)).toBe(0);
  });

  it("legacy complete rows with no doneAt count on no day", () => {
    const rows = [row("complete", null)];
    expect(countImprovementsCompletedInWindow(rows, dayStart, dayEnd)).toBe(0);
  });

  it("treats the window as inclusive at both London-midnight boundaries", () => {
    const rows = [
      row("complete", "2026-09-16T23:00:00.000Z"), // 00:00:00.000 London
      row("complete", "2026-09-17T22:59:59.999Z"), // 23:59:59.999 London
      row("complete", "2026-09-16T22:59:59.999Z"), // the day before, last ms
      row("complete", "2026-09-17T23:00:00.000Z"), // the day after, first ms
    ];
    expect(countImprovementsCompletedInWindow(rows, dayStart, dayEnd)).toBe(2);
  });

  it("an empty day is a real zero", () => {
    expect(countImprovementsCompletedInWindow([], dayStart, dayEnd)).toBe(0);
  });

  it("the done statuses are exactly awaiting_approval and complete", () => {
    // The dead July-2026 enum values must never sneak into the count.
    expect([...IMPROVEMENT_DONE_STATUSES].sort()).toEqual(["awaiting_approval", "complete"]);
    for (const dead of ["acknowledged", "approved", "in_development", "testing"]) {
      expect(
        countImprovementsCompletedInWindow([row(dead, "2026-09-17T10:00:00Z")], dayStart, dayEnd),
      ).toBe(0);
    }
  });
});
