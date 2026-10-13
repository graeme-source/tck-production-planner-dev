import { describe, expect, it } from "vitest";
import { planMergeIntoAgreement, objectiveBullet, type MergeNote } from "./merge-review-objectives";

const T = new Date("2026-10-12T10:00:00Z");
const LATER = new Date("2026-10-12T11:00:00Z");
const note = (id: number, over: Partial<MergeNote> = {}): MergeNote => ({
  id, entryId: 5, userId: 40, kind: "objective", title: `Point ${id}`, body: `Detail ${id}`, visibility: "private",
  sharedAt: null, authorId: 2, authorName: "Test Author", createdAt: T, doneAt: null, deletedAt: null, ...over,
});

describe("merging a review's AI objectives into one agreed list", () => {
  it("one bullet each, 'Title — body'", () => {
    expect(objectiveBullet({ title: "Return date", body: "Back on 4 May 2027" })).toBe("Return date — Back on 4 May 2027");
    expect(objectiveBullet({ title: null, body: " Two  KIT days " })).toBe("Two KIT days");
    expect(objectiveBullet({ title: "Same", body: "same" })).toBe("Same");
  });

  it("finds the AI save's objectives by the source time, keeps author, time and state", () => {
    const notes = [note(1), note(2), note(3, { createdAt: LATER }), note(4, { kind: "note" })];
    const p = planMergeIntoAgreement({ entryId: 5, notes, sourceTimes: [T] });
    expect(p.ok && !p.nothing).toBe(true);
    if (!p.ok || p.nothing) return;
    expect(p.mergeIds).toEqual([1, 2]);
    expect(p.appendTo).toBeNull();
    expect(p.insert).toMatchObject({
      entryId: 5, userId: 40, kind: "agreement", title: "What was agreed",
      body: "• Point 1 — Detail 1\n• Point 2 — Detail 2", visibility: "private", sharedAt: null,
      authorId: 2, authorName: "Test Author", createdAt: T,
    });
    expect(p.auditDetail).toMatch(/2 objectives \(#1, #2\) merged/);
  });

  it("a shared set stays shared, from the first time it was shared", () => {
    const s1 = new Date("2026-10-12T12:00:00Z");
    const s2 = new Date("2026-10-12T13:00:00Z");
    const p = planMergeIntoAgreement({ entryId: 5, notes: [note(1, { visibility: "shared", sharedAt: s2 }), note(2, { visibility: "shared", sharedAt: s1 })], sourceTimes: [T] });
    expect(p.ok && !p.nothing && p.insert).toMatchObject({ visibility: "shared", sharedAt: s1 });
  });

  it("joins the author's existing list on that review (one list per review)", () => {
    const list = note(9, { kind: "agreement", title: "What was agreed", body: "• Point 1 — Detail 1", createdAt: LATER });
    const p = planMergeIntoAgreement({ entryId: 5, notes: [note(1), note(2), list], sourceTimes: [T] });
    expect(p.ok && !p.nothing && p.appendTo).toEqual({ id: 9, body: "• Point 1 — Detail 1\n• Point 2 — Detail 2" });
    expect(p.ok && !p.nothing && p.insert).toBeNull();
  });

  it("is idempotent: once soft-deleted, nothing is left to merge", () => {
    const gone = new Date();
    expect(planMergeIntoAgreement({ entryId: 5, notes: [note(1, { deletedAt: gone })], sourceTimes: [T] })).toMatchObject({ ok: true, nothing: true });
    expect(planMergeIntoAgreement({ entryId: 5, notes: [note(1, { deletedAt: gone })], sourceTimes: [T], noteIds: [1] })).toMatchObject({ ok: true, nothing: true });
  });

  it("--notes picks them by id, and only objectives on that entry", () => {
    const notes = [note(1, { createdAt: LATER }), note(2), note(3, { kind: "feedback" }), note(4, { entryId: 6 })];
    const p = planMergeIntoAgreement({ entryId: 5, notes, sourceTimes: [], noteIds: [1, 2] });
    expect(p.ok && !p.nothing && p.mergeIds).toEqual([2, 1]);
    expect(planMergeIntoAgreement({ entryId: 5, notes, sourceTimes: [], noteIds: [3] })).toMatchObject({ ok: false });
    expect(planMergeIntoAgreement({ entryId: 5, notes, sourceTimes: [], noteIds: [4] })).toMatchObject({ ok: false });
  });

  it("refuses to guess: no source, mixed authors, or mixed private/shared", () => {
    expect(planMergeIntoAgreement({ entryId: 5, notes: [note(1)], sourceTimes: [] })).toMatchObject({ ok: false });
    expect(planMergeIntoAgreement({ entryId: 5, notes: [note(1), note(2, { authorId: 3 })], sourceTimes: [T] })).toMatchObject({ ok: false });
    expect(planMergeIntoAgreement({ entryId: 5, notes: [note(1), note(2, { visibility: "shared" })], sourceTimes: [T] })).toMatchObject({ ok: false });
  });

  it("warns when a merged objective had been ticked done", () => {
    const p = planMergeIntoAgreement({ entryId: 5, notes: [note(1, { doneAt: LATER }), note(2)], sourceTimes: [T] });
    expect(p.ok && !p.nothing && p.warnings).toHaveLength(1);
  });
});
