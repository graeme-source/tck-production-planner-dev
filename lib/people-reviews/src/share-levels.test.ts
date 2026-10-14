import { describe, it, expect } from "vitest";
import {
  noteLevel, levelLabel, patchForLevel, cleanHrViewerIds, canConfirmShare, needsDoubleConfirm,
  whoWillSee, confirmLabel, levelAuditDetail, joinNames, type ShareDialogState,
} from "./share-levels";

describe("noteLevel", () => {
  it("reads the three levels", () => {
    expect(noteLevel({ visibility: "private", sharedWithUserIds: [] })).toBe("private");
    expect(noteLevel({ visibility: "private", sharedWithUserIds: [3] })).toBe("hr");
    expect(noteLevel({ visibility: "shared", sharedWithUserIds: [] })).toBe("colleague");
  });
  it("fails closed: anything odd is private", () => {
    expect(noteLevel({ visibility: "Shared" })).toBe("private");
    expect(noteLevel({ visibility: "private", sharedWithUserIds: null })).toBe("private");
  });
});

describe("labels", () => {
  it("say who can see it", () => {
    expect(levelLabel("private", { colleagueFirst: "Alex", hrNames: [] })).toBe("Private to you");
    expect(levelLabel("hr", { colleagueFirst: "Alex", hrNames: ["Sam"] })).toBe("Shared with Sam");
    expect(levelLabel("hr", { colleagueFirst: "Alex", hrNames: ["Sam", "Pat"] })).toBe("Shared with Sam and Pat");
    expect(levelLabel("colleague", { colleagueFirst: "Alex", hrNames: ["Sam"] })).toBe("Shared with Alex");
  });
  it("joins names plainly", () => {
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
    expect(joinNames([])).toBe("");
  });
});

describe("patchForLevel", () => {
  it("HR is a private note with names on it; private clears the names", () => {
    expect(patchForLevel("hr", [3, 3, 5])).toEqual({ visibility: "private", sharedWithUserIds: [3, 5] });
    expect(patchForLevel("private", [3])).toEqual({ visibility: "private", sharedWithUserIds: [] });
    expect(patchForLevel("colleague", [3])).toEqual({ visibility: "shared" });
  });
});

describe("cleanHrViewerIds (server)", () => {
  const allowed = new Set([1, 3, 5]);
  const o = { allowed, authorId: 1, subjectUserId: 9 };
  it("keeps People-access colleagues, drops the author and duplicates", () => {
    expect(cleanHrViewerIds([5, 3, 3, 1], o)).toEqual({ ok: true, ids: [3, 5] });
  });
  it("refuses the person the note is about", () => {
    expect(cleanHrViewerIds([3, 9], o).ok).toBe(false);
  });
  it("refuses anyone without People access to this record", () => {
    expect(cleanHrViewerIds([4], o).ok).toBe(false);
  });
});

describe("the confirm steps", () => {
  const base: ShareDialogState = { target: "colleague", step: 1, checked: false, hrUserIds: [] };

  it("sharing with the colleague needs step 2 AND the tick", () => {
    expect(needsDoubleConfirm("colleague", "private")).toBe(true);
    expect(needsDoubleConfirm("colleague", "hr")).toBe(true);
    expect(canConfirmShare(base, "private")).toBe(false);
    expect(canConfirmShare({ ...base, checked: true }, "private")).toBe(false);   // still step 1
    expect(canConfirmShare({ ...base, step: 2 }, "private")).toBe(false);         // not ticked
    expect(canConfirmShare({ ...base, step: 2, checked: true }, "private")).toBe(true);
  });

  it("sharing with HR needs one confirmation and at least one person", () => {
    expect(needsDoubleConfirm("hr", "private")).toBe(false);
    expect(canConfirmShare({ ...base, target: "hr" }, "private")).toBe(false);
    expect(canConfirmShare({ ...base, target: "hr", hrUserIds: [3] }, "private")).toBe(true);
  });

  it("taking it back to private is one confirmation", () => {
    expect(needsDoubleConfirm("private", "colleague")).toBe(false);
    expect(canConfirmShare({ ...base, target: "private" }, "colleague")).toBe(true);
  });

  it("choosing where it already is does nothing", () => {
    expect(canConfirmShare({ ...base, target: "private" }, "private")).toBe(false);
    expect(canConfirmShare({ ...base, step: 2, checked: true }, "colleague")).toBe(false);
  });
});

describe("the dialog's words", () => {
  it("says exactly who will see it", () => {
    expect(whoWillSee("colleague", { colleagueFirst: "Alex", hrNames: [], othersWithAccess: ["Sam"] }))
      .toBe("Alex will see this in their Employee Hub and get a notification in the app. Sam can read it too (People access).");
    expect(whoWillSee("hr", { colleagueFirst: "Alex", hrNames: ["Sam"], othersWithAccess: [] }))
      .toBe("Only you and Sam will be able to read it. Not Alex, not anyone else.");
    expect(whoWillSee("private", { colleagueFirst: "Alex", hrNames: [], othersWithAccess: [] })).toBe("Only you will be able to read it.");
  });
  it("labels the final button", () => {
    expect(confirmLabel("colleague", { colleagueFirst: "Alex", hrNames: [] })).toBe("Share with Alex");
    expect(confirmLabel("hr", { colleagueFirst: "Alex", hrNames: ["Sam"] })).toBe("Share with Sam");
  });
  it("audits the change without names or content", () => {
    expect(levelAuditDetail("Note", "private", "hr", 1)).toBe("Note shared with 1 HR colleague");
    expect(levelAuditDetail("Note", "colleague", "private", 0)).toBe("Note made private again");
  });
});
