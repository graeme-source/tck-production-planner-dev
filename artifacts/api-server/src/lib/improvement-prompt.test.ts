import { describe, expect, it } from "vitest";
import { answerProblem, answerRow, summariseUptake, type UptakeRow } from "./improvement-prompt";

describe("recording the end-of-day improvement answer", () => {
  it("a yes needs the improvement it's about", () => {
    expect(answerProblem({ answer: "yes" })).toMatch(/Log the improvement/);
    expect(answerProblem({ answer: "yes", improvementId: null })).toMatch(/Log the improvement/);
    expect(answerProblem({ answer: "yes", improvementId: 12 })).toBeNull();
  });

  it("a no is just a no", () => {
    expect(answerProblem({ answer: "no" })).toBeNull();
    expect(answerProblem({ answer: "no", improvementId: 12 })).toMatch(/can't have an improvement/);
  });

  it("stores the improvement with a yes and never with a no", () => {
    expect(answerRow({ answer: "yes", improvementId: 7 })).toEqual({ answer: "yes", improvementId: 7 });
    expect(answerRow({ answer: "no", improvementId: 7 })).toEqual({ answer: "no", improvementId: null });
    expect(answerRow({ answer: "no" })).toEqual({ answer: "no", improvementId: null });
  });
});

describe("uptake summary for managers", () => {
  const row = (day: string, userId: number, answer: "yes" | "no"): UptakeRow => ({
    day, userId, name: `P${userId}`, answer,
    improvementId: answer === "yes" ? 100 + userId : null, improvementTitle: null, stationType: "wrapping",
  });

  it("counts yes/no per day, newest day first, with totals", () => {
    const out = summariseUptake([
      row("2026-10-26", 1, "yes"),
      row("2026-10-27", 1, "no"),
      row("2026-10-27", 2, "yes"),
      row("2026-10-27", 3, "yes"),
    ]);
    expect(out.days).toEqual([
      { day: "2026-10-27", yes: 2, no: 1 },
      { day: "2026-10-26", yes: 1, no: 0 },
    ]);
    expect(out.totals).toEqual({ yes: 3, no: 1, answered: 4, people: 3 });
  });

  it("nothing answered is all zeros", () => {
    expect(summariseUptake([])).toEqual({ days: [], totals: { yes: 0, no: 0, answered: 0, people: 0 } });
  });
});
