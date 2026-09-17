import { describe, it, expect } from "vitest";
import {
  canManageRecord, canOpenRecord, canReadNote, visibleNotes,
  type ReviewNoteForVisibility, type ReviewViewer,
} from "./employee-review-visibility";

const GRAEME: ReviewViewer = { id: 1, role: "admin", email: "graeme@thecalzonekitchen.co.uk" };
// A second admin who is NOT on the people-data list — Jane Miles on live.
const OTHER_ADMIN: ReviewViewer = { id: 2, role: "admin", email: "jane@thecalzonekitchen.co.uk" };
const LORNA: ReviewViewer = { id: 3, role: "manager", email: "lornabrown17@icloud.com" };
// A manager who is NOT on the list — Dave Bewsey on live.
const OTHER_MANAGER: ReviewViewer = { id: 4, role: "manager", email: "dave@thecalzonekitchen.co.uk" };
const SUBJECT: ReviewViewer = { id: 9, role: "viewer", email: "subject@thecalzonekitchen.co.uk" };
const BYSTANDER: ReviewViewer = { id: 10, role: "viewer", email: "bystander@thecalzonekitchen.co.uk" };

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
    expect(canReadNote(shared(), GRAEME, SUBJECT.id)).toBe(true);
  });

  it("are NOT readable by an admin or manager outside that pair", () => {
    // Tightened 2026-09-17: this used to pass for any admin. "Shared" means
    // shared with the person and the two who look after their record, not
    // published to management.
    expect(canReadNote(shared(), OTHER_ADMIN, SUBJECT.id)).toBe(false);
    expect(canReadNote(shared(), OTHER_MANAGER, SUBJECT.id)).toBe(false);
  });

  it("are not readable by an unrelated colleague", () => {
    expect(canReadNote(shared(), BYSTANDER, SUBJECT.id)).toBe(false);
  });
});

describe("opening a record", () => {
  it("lets someone open their own", () => {
    expect(canOpenRecord(SUBJECT, SUBJECT.id)).toBe(true);
  });

  it("lets the two people who look after records open anyone's", () => {
    expect(canOpenRecord(LORNA, SUBJECT.id)).toBe(true);
    expect(canOpenRecord(GRAEME, SUBJECT.id)).toBe(true);
  });

  it("REGRESSION: another admin or manager cannot open someone else's", () => {
    // It was role-based, so every admin and manager could read anyone's
    // probation meetings and feedback — five people on live, not two
    // (Graeme, 2026-09-17: "me and Lorna only, strictly").
    expect(canOpenRecord(OTHER_ADMIN, SUBJECT.id)).toBe(false);
    expect(canOpenRecord(OTHER_MANAGER, SUBJECT.id)).toBe(false);
  });

  it("still lets anyone open their OWN record, whatever their role", () => {
    expect(canOpenRecord(OTHER_MANAGER, OTHER_MANAGER.id)).toBe(true);
    expect(canOpenRecord(BYSTANDER, BYSTANDER.id)).toBe(true);
  });

  it("keeps one team member out of another's", () => {
    expect(canOpenRecord(BYSTANDER, SUBJECT.id)).toBe(false);
  });
});

describe("canManageRecord", () => {
  it("is the two named people, by email", () => {
    expect(canManageRecord(GRAEME)).toBe(true);
    expect(canManageRecord(LORNA)).toBe(true);
  });

  it("is NOT granted by a role — promoting someone must not hand over the files", () => {
    expect(canManageRecord(OTHER_ADMIN)).toBe(false);
    expect(canManageRecord(OTHER_MANAGER)).toBe(false);
    expect(canManageRecord(BYSTANDER)).toBe(false);
  });

  it("fails closed on a missing or empty email", () => {
    expect(canManageRecord({ email: null })).toBe(false);
    expect(canManageRecord({ email: undefined })).toBe(false);
    expect(canManageRecord({ email: "" })).toBe(false);
    expect(canManageRecord({ email: "   " })).toBe(false);
  });

  it("is not case- or whitespace-sensitive", () => {
    expect(canManageRecord({ email: "  Graeme@TheCalzoneKitchen.co.uk " })).toBe(true);
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

describe("shared notes stay visible to whoever shared them", () => {
  const sharedByGraeme: ReviewNoteForVisibility = { authorId: 1, visibility: "shared" };

  it("REGRESSION: a viewer built without an email loses sight of shared notes", () => {
    // canReadNote sends a SHARED note through canManageRecord, which became
    // identity-based on 2026-09-17. A call site that built the viewer as
    // { id, role } — dropping email — therefore hid a note from the person
    // who had just shared it. Caught same day, before anyone hit it.
    const noEmail = { id: GRAEME.id, role: GRAEME.role } as ReviewViewer;
    expect(canReadNote(sharedByGraeme, noEmail, SUBJECT.id)).toBe(false);
    expect(canReadNote(sharedByGraeme, GRAEME, SUBJECT.id)).toBe(true);
  });

  it("the person it is about reads it whatever their role or email", () => {
    expect(canReadNote(sharedByGraeme, SUBJECT, SUBJECT.id)).toBe(true);
  });
});
