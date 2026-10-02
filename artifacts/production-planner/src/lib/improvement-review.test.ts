import { describe, it, expect } from "vitest";
import { isIdea, needsReview, feedShownCount, FEED_PAGE_SIZE } from "./improvement-review";

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

describe("feed shows 10 at a time (2026-10-02)", () => {
  it("shows what's been scrolled to, capped at the total", () => {
    expect(feedShownCount(111, FEED_PAGE_SIZE, -1)).toBe(10);
    expect(feedShownCount(111, 20, -1)).toBe(20);
    expect(feedShownCount(5, 10, -1)).toBe(5);
  });
  it("always reaches the oldest unseen improvement", () => {
    expect(feedShownCount(111, 10, 14)).toBe(15);
  });
});
