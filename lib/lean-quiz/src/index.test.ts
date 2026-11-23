import { describe, expect, it } from "vitest";
import { checkQuiz } from "./index";

describe("checkQuiz", () => {
  it("trims text and keeps a good quiz", () => {
    expect(checkQuiz([{ question: " Why sweep? ", options: [" To reset ", "For fun"], answer: 0 }]))
      .toEqual({ ok: true, quiz: [{ question: "Why sweep?", options: ["To reset", "For fun"], answer: 0 }] });
  });
  it("drops blank answers and moves the right-answer mark with its answer", () => {
    expect(checkQuiz([{ question: "Q", options: ["A", "  ", "C"], answer: 2 }]))
      .toEqual({ ok: true, quiz: [{ question: "Q", options: ["A", "C"], answer: 1 }] });
  });
  it("refuses a quiz that can't be answered", () => {
    expect(checkQuiz([])).toEqual({ ok: false, problem: "Add at least one question" });
    expect(checkQuiz([{ question: " ", options: ["A", "B"], answer: 0 }])).toEqual({ ok: false, problem: "Question 1 needs its question" });
    expect(checkQuiz([{ question: "Q", options: ["A", ""], answer: 0 }])).toEqual({ ok: false, problem: "Question 1 needs at least two answers" });
    expect(checkQuiz([{ question: "Q", options: ["A", "B", ""], answer: 2 }])).toEqual({ ok: false, problem: "Question 1: tick the right answer" });
  });
});
