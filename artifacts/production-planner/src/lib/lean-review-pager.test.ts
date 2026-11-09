import { describe, expect, it } from "vitest";
import { pagerAction } from "./lean-review-pager";

describe("pagerAction", () => {
  it("finishes on the last page of a week with no quiz (3S overview, 9 Nov 2026)", () => {
    expect(pagerAction({ pageIdx: 4, lessonCount: 5, hasQuiz: false, done: false })).toBe("finish");
  });

  it("has nothing left to press once that week is finished", () => {
    expect(pagerAction({ pageIdx: 4, lessonCount: 5, hasQuiz: false, done: true })).toBe("none");
  });

  it("moves on through the pages before that", () => {
    expect(pagerAction({ pageIdx: 0, lessonCount: 5, hasQuiz: false, done: false })).toBe("next");
    expect(pagerAction({ pageIdx: 3, lessonCount: 5, hasQuiz: false, done: true })).toBe("next");
  });

  it("goes to the quiz from the last page when there is one", () => {
    expect(pagerAction({ pageIdx: 4, lessonCount: 5, hasQuiz: true, done: false })).toBe("quiz");
    expect(pagerAction({ pageIdx: 2, lessonCount: 5, hasQuiz: true, done: false })).toBe("next");
  });

  it("leaves the quiz page to its own Check my answers button", () => {
    expect(pagerAction({ pageIdx: 5, lessonCount: 5, hasQuiz: true, done: false })).toBe("none");
  });

  it("can still be finished if a week has no pages at all", () => {
    expect(pagerAction({ pageIdx: 0, lessonCount: 0, hasQuiz: false, done: false })).toBe("finish");
  });
});
