import { describe, expect, it } from "vitest";
import { reviewFooterMode, showShareInFooter, summariseSaveStates, SAVE_SUMMARY_LABEL } from "./review-footer";

describe("reviewFooterMode", () => {
  it("shows the draft's Save to record while an AI draft is open", () => {
    expect(reviewFooterMode({ aiOpen: true, hasDraft: true, byHand: false })).toBe("ai-draft");
  });
  it("shows Read the notes while the AI panel has nothing read yet", () => {
    expect(reviewFooterMode({ aiOpen: true, hasDraft: false, byHand: false })).toBe("ai-paste");
  });
  it("the AI panel wins over the by-hand composer", () => {
    expect(reviewFooterMode({ aiOpen: true, hasDraft: true, byHand: true })).toBe("ai-draft");
  });
  it("shows the composer's save when writing by hand", () => {
    expect(reviewFooterMode({ aiOpen: false, hasDraft: false, byHand: true })).toBe("by-hand");
  });
  it("otherwise shows the autosave state", () => {
    expect(reviewFooterMode({ aiOpen: false, hasDraft: false, byHand: false })).toBe("autosave");
  });
});

describe("showShareInFooter", () => {
  it("only beside the autosave state, and only with something private of yours", () => {
    expect(showShareInFooter("autosave", true)).toBe(true);
    expect(showShareInFooter("autosave", false)).toBe(false);
    expect(showShareInFooter("ai-draft", true)).toBe(false);
    expect(showShareInFooter("by-hand", true)).toBe(false);
  });
});

describe("summariseSaveStates", () => {
  it("nothing touched is all saved", () => {
    expect(summariseSaveStates([])).toBe("saved");
    expect(summariseSaveStates(["idle", "saved"])).toBe("saved");
    expect(SAVE_SUMMARY_LABEL.saved).toBe("All changes saved ✓");
  });
  it("a failure wins, so the retry is offered", () => {
    expect(summariseSaveStates(["saving", "error", "dirty"])).toBe("error");
    expect(SAVE_SUMMARY_LABEL.error).toBe("Not saved — retry");
  });
  it("saving beats waiting to save", () => {
    expect(summariseSaveStates(["dirty", "saving"])).toBe("saving");
    expect(summariseSaveStates(["saved", "dirty"])).toBe("pending");
  });
});
