import { describe, expect, it } from "vitest";
import { surveySaveProblems } from "./survey-save-problems";

const q = (key: string, prompt: string, type = "slider", options: string[] = []) => ({ key, type, prompt, options });

describe("surveySaveProblems", () => {
  it("a finished survey has nothing stopping it saving", () => {
    expect(surveySaveProblems({ title: "Winter Warmers", questions: [q("a", "How was it?")] })).toEqual([]);
  });

  // Regression, 11 Nov: adding a question greyed Save with no reason given.
  it("a just-added blank question is named by its number", () => {
    const problems = surveySaveProblems({
      title: "Winter Warmers",
      questions: [q("a", "How was it?"), q("b", "  ")],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].questionKey).toBe("b");
    expect(problems[0].summary).toBe("Question 2 has no wording yet");
  });

  it("choice questions need two real options", () => {
    const problems = surveySaveProblems({
      title: "T",
      questions: [q("a", "Pick one", "choice", ["Yes", " "])],
    });
    expect(problems.map(p => p.summary)).toEqual(["Question 1 needs at least 2 options"]);
    expect(surveySaveProblems({ title: "T", questions: [q("a", "Pick", "choice", ["Yes", "No"])] })).toEqual([]);
  });

  it("covers the title, no questions and final page problems", () => {
    const problems = surveySaveProblems({ title: " ", questions: [], finalPageProblems: ["Add a button link"] });
    expect(problems.map(p => p.summary)).toEqual([
      "Give the survey a title",
      "Add at least one question",
      "Final page: Add a button link",
    ]);
  });
});
