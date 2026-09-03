import { describe, it, expect } from "vitest";
import {
  canManageRecord, canOpenRecord, canReadNote, visibleNotes,
  type ReviewNoteForVisibility, type ReviewViewer,
} from "./employee-review-visibility";

const GRAEME: ReviewViewer = { id: 1, role: "admin" };
const OTHER_ADMIN: ReviewViewer = { id: 2, role: "admin" };
const LORNA: ReviewViewer = { id: 3, role: "manager" };
const SUBJECT: ReviewViewer = { id: 9, role: "viewer" };
const BYSTANDER: ReviewViewer = { id: 10, role: "viewer" };

const priv = (authorId: number | null = GRAEME.id): ReviewNoteForVisibility =>
  ({ authorId, visibility: "private" });
const shared = (authorId: number | null = GRAEME.id): ReviewNoteForVisibility =>
  ({ authorId, visibility: "shared" });

describe("private notes", () => {
  it("are readable by whoever wrote them", () => {
    expect(canReadNote(priv(), GRAEME, SUBJECT.id)).toBe(true);
  });

  // The rule Graeme was explicit about: private means private to him, not
  // "private to management" (2026-09-03).
  it("are NOT readable by another admin", () => {
    expect(canReadNote(priv(), OTHER_ADMIN, SUBJECT.id)).toBe(false);
  });

  it("are NOT readable by a manager", () => {
    expect(canReadNote(priv(), LORNA, SUBJECT.id)).toBe(false);
  });

  // The whole point of the feature: notes he hasn't chosen to publish must
  // never reach the person they are about.
  it("are NEVER readable by the employee they are about", () => {
    expect(canReadNote(priv(), SUBJECT, SUBJECT.id)).toBe(false);
  });

  it("are not readable by an unrelated colleague", () => {
    expect(canReadNote(priv(), BYSTANDER, SUBJECT.id)).toBe(false);
  });

  it("open up only when access is explicitly switched on for someone", () => {
    expect(canReadNote(priv(), { ...LORNA, hasPrivateGrant: true }, SUBJECT.id)).toBe(true);
  });

  // A grant is about the private side of the record; it must not be a way for
  // the subject to read notes about themselves that were never published.
  it("stay hidden from the subject even with a grant flag set", () => {
    // The server never sets a grant for the subject; belt and braces if it did.
    expect(canReadNote(priv(GRAEME.id), { ...SUBJECT, hasPrivateGrant: false }, SUBJECT.id)).toBe(false);
  });

  it("do not leak when the author's account is gone", () => {
    expect(canReadNote(priv(null), OTHER_ADMIN, SUBJECT.id)).toBe(false);
    expect(canReadNote(priv(null), SUBJECT, SUBJECT.id)).toBe(false);
  });
});

describe("shared notes", () => {
  it("reach the person they are about", () => {
    expect(canReadNote(shared(), SUBJECT, SUBJECT.id)).toBe(true);
  });

  it("are readable by whoever looks after the record", () => {
    expect(canReadNote(shared(), LORNA, SUBJECT.id)).toBe(true);
    expect(canReadNote(shared(), OTHER_ADMIN, SUBJECT.id)).toBe(true);
  });

  it("are not readable by an unrelated colleague", () => {
    expect(canReadNote(shared(), BYSTANDER, SUBJECT.id)).toBe(false);
  });
});

describe("opening a record", () => {
  it("lets someone open their own", () => {
    expect(canOpenRecord(SUBJECT, SUBJECT.id)).toBe(true);
  });

  it("lets managers and admins open anyone's", () => {
    expect(canOpenRecord(LORNA, SUBJECT.id)).toBe(true);
    expect(canOpenRecord(GRAEME, SUBJECT.id)).toBe(true);
  });

  it("keeps one team member out of another's", () => {
    expect(canOpenRecord(BYSTANDER, SUBJECT.id)).toBe(false);
  });
});

describe("canManageRecord", () => {
  it("is managers and admins only", () => {
    expect(canManageRecord({ role: "admin" })).toBe(true);
    expect(canManageRecord({ role: "manager" })).toBe(true);
    expect(canManageRecord({ role: "viewer" })).toBe(false);
    expect(canManageRecord({ role: "" })).toBe(false);
  });
});

describe("visibleNotes", () => {
  const record = [priv(GRAEME.id), shared(GRAEME.id), priv(LORNA.id), shared(LORNA.id)];

  it("gives the employee only what was shared with them", () => {
    const seen = visibleNotes(record, SUBJECT, SUBJECT.id);
    expect(seen).toHaveLength(2);
    expect(seen.every(n => n.visibility === "shared")).toBe(true);
  });

  it("gives an admin the shared notes plus their own private ones", () => {
    const seen = visibleNotes(record, GRAEME, SUBJECT.id);
    expect(seen).toHaveLength(3);
    expect(seen.filter(n => n.visibility === "private")).toEqual([priv(GRAEME.id)]);
  });

  it("gives a colleague nothing at all", () => {
    expect(visibleNotes(record, BYSTANDER, SUBJECT.id)).toEqual([]);
  });

  it("returns nothing for an empty record rather than failing", () => {
    expect(visibleNotes([], GRAEME, SUBJECT.id)).toEqual([]);
  });
});

describe("unexpected data fails closed", () => {
  // A visibility value we don't recognise — a typo, a half-finished
  // migration, a hand-edited row — must behave as PRIVATE. Failing open here
  // would publish something nobody chose to publish.
  const odd = { authorId: 1, visibility: "Shared" };   // wrong case
  const blank = { authorId: 1, visibility: "" };

  it("hides a note whose visibility isn't exactly 'shared'", () => {
    expect(canReadNote(odd, SUBJECT, SUBJECT.id)).toBe(false);
    expect(canReadNote(blank, SUBJECT, SUBJECT.id)).toBe(false);
    expect(canReadNote(odd, LORNA, SUBJECT.id)).toBe(false);
  });

  it("still lets the author see their own", () => {
    expect(canReadNote(odd, GRAEME, SUBJECT.id)).toBe(true);
  });
});
