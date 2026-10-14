import { describe, expect, it } from "vitest";
import { looseNoteDate, looseNoteAuditDetail, looseNoteCanSave, LOOSE_NOTE_BODY_MAX } from "./index";

const TODAY = "2026-10-14";

describe("a loose note's date", () => {
  it("no date, or today, is stamped now", () => {
    expect(looseNoteDate(undefined, TODAY)).toEqual({ ok: true, createdAt: null });
    expect(looseNoteDate(null, TODAY)).toEqual({ ok: true, createdAt: null });
    expect(looseNoteDate("", TODAY)).toEqual({ ok: true, createdAt: null });
    expect(looseNoteDate(TODAY, TODAY)).toEqual({ ok: true, createdAt: null });
  });

  it("an earlier day is written at midday UTC, so it reads as that day in London (summer and winter)", () => {
    const summer = looseNoteDate("2026-07-01", TODAY);
    const winter = looseNoteDate("2026-01-15", TODAY);
    expect(summer.ok && summer.createdAt?.toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(winter.ok && winter.createdAt?.toISOString()).toBe("2026-01-15T12:00:00.000Z");
    // The record dates a loose note by createdAt's first ten characters.
    expect(summer.ok && summer.createdAt?.toISOString().slice(0, 10)).toBe("2026-07-01");
  });

  it("refuses a day still to come", () => {
    const r = looseNoteDate("2026-10-15", TODAY);
    expect(r.ok).toBe(false);
  });

  it("refuses a day that doesn't exist", () => {
    expect(looseNoteDate("2026-02-30", TODAY).ok).toBe(false);
    expect(looseNoteDate("14/10/2026", TODAY).ok).toBe(false);
  });
});

describe("a loose note's audit line", () => {
  it("says private or shared, and the date only when backdated — never what's in it", () => {
    expect(looseNoteAuditDetail(false, null, TODAY)).toBe("Note added (private)");
    expect(looseNoteAuditDetail(true, TODAY, TODAY)).toBe("Note added (shared with them)");
    expect(looseNoteAuditDetail(false, "2026-10-01", TODAY)).toBe("Note added (private, dated 2026-10-01)");
  });
});

describe("saving a loose note", () => {
  it("needs something written, within the limit", () => {
    expect(looseNoteCanSave("")).toBe(false);
    expect(looseNoteCanSave("   \n ")).toBe(false);
    expect(looseNoteCanSave("Helped train the new starter on wrapping")).toBe(true);
    expect(looseNoteCanSave("x".repeat(LOOSE_NOTE_BODY_MAX + 1))).toBe(false);
  });
});
