import { describe, it, expect } from "vitest";
import {
  stageOf, STAGE_LABEL, canMarkDone, markDoneBlocker, canReview, countsForCredit, shouldAutoSubmit, isCompletionMedia,
} from "./improvement-stage";

describe("stageOf", () => {
  it("maps the four live statuses", () => {
    expect(stageOf("submitted_for_review")).toBe("todo");
    expect(stageOf("awaiting_approval")).toBe("waiting");
    expect(stageOf("complete")).toBe("approved");
    expect(stageOf("rejected")).toBe("sent_back");
  });

  it("reads legacy statuses as still to do, never as approved", () => {
    for (const dead of ["acknowledged", "approved", "in_development", "testing"]) {
      expect(stageOf(dead)).toBe("todo");
    }
  });

  it("treats an unknown status as to do rather than crashing", () => {
    expect(stageOf("something_new")).toBe("todo");
  });

  it("has a plain-English label for every stage", () => {
    expect(STAGE_LABEL[stageOf("awaiting_approval")]).toBe("Waiting for approval");
    expect(STAGE_LABEL[stageOf("complete")]).toBe("Approved");
  });
});

describe("canMarkDone — the media rule", () => {
  // The rule the whole Centre rests on: no photo or video, no improvement.
  it("refuses without media", () => {
    expect(canMarkDone("submitted_for_review", 0)).toBe(false);
    expect(markDoneBlocker("submitted_for_review", 0)).toMatch(/photo or a video/);
  });

  it("allows once there's at least one photo or video", () => {
    expect(canMarkDone("submitted_for_review", 1)).toBe(true);
    expect(markDoneBlocker("submitted_for_review", 1)).toBeNull();
  });

  it("lets a sent-back improvement be fixed and re-submitted", () => {
    expect(canMarkDone("rejected", 2)).toBe(true);
  });

  it("won't mark something done twice", () => {
    expect(canMarkDone("awaiting_approval", 3)).toBe(false);
    expect(markDoneBlocker("awaiting_approval", 3)).toMatch(/already waiting/);
  });

  it("won't re-open an approved improvement", () => {
    expect(canMarkDone("complete", 3)).toBe(false);
    expect(markDoneBlocker("complete", 3)).toMatch(/already approved/);
  });

  it("blocks a legacy-status row with no media, same as any other", () => {
    expect(canMarkDone("in_development", 0)).toBe(false);
  });
});

describe("canReview", () => {
  it("is only possible on something actually waiting", () => {
    expect(canReview("awaiting_approval")).toBe(true);
    expect(canReview("submitted_for_review")).toBe(false);
    expect(canReview("complete")).toBe(false);
    expect(canReview("rejected")).toBe(false);
  });
});

describe("countsForCredit", () => {
  it("counts only approved improvements", () => {
    expect(countsForCredit("complete")).toBe(true);
    expect(countsForCredit("awaiting_approval")).toBe(false);
    expect(countsForCredit("submitted_for_review")).toBe(false);
  });

  it("does not count the legacy 'approved' status, which was never checked", () => {
    // Dead value from the old workflow — it never meant a manager approved it.
    expect(countsForCredit("approved")).toBe(false);
  });
});

describe("shouldAutoSubmit", () => {
  it("submits a to-do improvement the moment the after photo lands", () => {
    expect(shouldAutoSubmit("submitted_for_review", "after", 1)).toBe(true);
  });

  it("counts unlabelled media — it predates the before/after split", () => {
    expect(shouldAutoSubmit("submitted_for_review", null, 1)).toBe(true);
  });

  it("leaves a logged idea alone when only the before photo is in", () => {
    // Otherwise every idea someone photographs lands in the approval queue
    // the second it's raised, and the To-do board empties.
    expect(shouldAutoSubmit("submitted_for_review", "before", 1)).toBe(false);
  });

  it("does nothing until there's a photo at all", () => {
    expect(shouldAutoSubmit("submitted_for_review", "after", 0)).toBe(false);
  });

  it("treats the dead July-2026 statuses as to-do too", () => {
    expect(shouldAutoSubmit("acknowledged", "after", 1)).toBe(true);
    expect(shouldAutoSubmit("in_development", "after", 1)).toBe(true);
  });

  it("never re-submits something already waiting or approved", () => {
    expect(shouldAutoSubmit("awaiting_approval", "after", 3)).toBe(false);
    expect(shouldAutoSubmit("complete", "after", 3)).toBe(false);
  });

  it("leaves a sent-back one to the person — the note may ask for more", () => {
    expect(shouldAutoSubmit("rejected", "after", 2)).toBe(false);
  });
});

describe("isCompletionMedia", () => {
  it("is the after shot, or an unlabelled one", () => {
    expect(isCompletionMedia("after")).toBe(true);
    expect(isCompletionMedia(null)).toBe(true);
    expect(isCompletionMedia(undefined)).toBe(true);
  });

  it("is never the before shot", () => {
    expect(isCompletionMedia("before")).toBe(false);
  });
});
