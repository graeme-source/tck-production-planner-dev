import { describe, it, expect } from "vitest";
import { isIdea, needsReview } from "./improvement-review";

describe("needsReview", () => {
  it("ideas never need reviewing, seen or not", () => {
    expect(needsReview({ stage: "todo", seenByMe: false, isMine: false })).toBe(false);
    expect(isIdea({ stage: "todo" })).toBe(true);
  });
  it("an unseen finished improvement from someone else does", () => {
    for (const stage of ["waiting", "approved", "sent_back"]) {
      expect(needsReview({ stage, seenByMe: false, isMine: false })).toBe(true);
    }
  });
  it("not once seen, and never my own", () => {
    expect(needsReview({ stage: "approved", seenByMe: true, isMine: false })).toBe(false);
    expect(needsReview({ stage: "approved", seenByMe: false, isMine: true })).toBe(false);
  });
});
