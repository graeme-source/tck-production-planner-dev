import { describe, expect, it } from "vitest";
import { BREAK_NOTE_MAX_LENGTH, canEditBreakNote, normaliseBreakNote } from "./break-note";

// Fix queue #61: when a break is interrupted (e.g. called back for APC) the
// person can leave an optional note on it, shown in Breaks & Lunches.
describe("normaliseBreakNote", () => {
  it("keeps a real note, trimmed", () => {
    expect(normaliseBreakNote("  called back for APC \n")).toBe("called back for APC");
  });

  it("treats blank as no note", () => {
    expect(normaliseBreakNote("")).toBeNull();
    expect(normaliseBreakNote("   ")).toBeNull();
    expect(normaliseBreakNote(null)).toBeNull();
    expect(normaliseBreakNote(undefined)).toBeNull();
  });

  it("cuts an over-long note to the limit", () => {
    expect(normaliseBreakNote("x".repeat(BREAK_NOTE_MAX_LENGTH + 50))).toHaveLength(BREAK_NOTE_MAX_LENGTH);
  });
});

describe("canEditBreakNote", () => {
  it("lets the person on the break write it", () => {
    expect(canEditBreakNote(7, 7, "viewer")).toBe(true);
  });
  it("stops someone else, unless they're a manager or admin", () => {
    expect(canEditBreakNote(7, 8, "viewer")).toBe(false);
    expect(canEditBreakNote(7, 8, "manager")).toBe(true);
    expect(canEditBreakNote(7, 8, "admin")).toBe(true);
  });
  it("allows a legacy break with no owner", () => {
    expect(canEditBreakNote(null, 8, "viewer")).toBe(true);
  });
});
