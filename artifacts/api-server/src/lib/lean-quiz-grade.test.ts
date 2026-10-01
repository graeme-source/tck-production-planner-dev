import { describe, expect, it } from "vitest";
import { gradeQuiz } from "./lean-quiz-grade";

const quiz = [{ answer: 0 }, { answer: 2 }, { answer: 1 }];

describe("lean quiz marking (preview must be answered, not shown — 2026-10-01)", () => {
  it("passes only on full marks", () => {
    expect(gradeQuiz(quiz, [0, 2, 1])).toEqual({ passed: true, correct: 3, total: 3 });
    expect(gradeQuiz(quiz, [0, 2, 0])).toEqual({ passed: false, correct: 2, total: 3 });
  });
  it("an unanswered or missing question is not a pass", () => {
    expect(gradeQuiz(quiz, [0, 2, -1]).passed).toBe(false);
    expect(gradeQuiz(quiz, [0, 2]).passed).toBe(false);
    expect(gradeQuiz(quiz, []).passed).toBe(false);
  });
  it("a lesson with no quiz passes", () => {
    expect(gradeQuiz([], []).passed).toBe(true);
  });
});
