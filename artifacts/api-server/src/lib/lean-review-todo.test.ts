import { describe, expect, it } from "vitest";
import { founderReviewTodo, leanWeekLabel } from "./lean-review-todo";

describe("leanWeekLabel", () => {
  it("tells the weeks of a subject apart", () => {
    expect(leanWeekLabel({ title: "3S", partIndex: 1 })).toBe("3S — overview");
    expect(leanWeekLabel({ title: "3S", partLabel: "Sweep", partIndex: 2 })).toBe("3S — Sweep");
    expect(leanWeekLabel({ title: "Seeing Waste" })).toBe("Seeing Waste");
  });
});

describe("founderReviewTodo", () => {
  it("asks for a review once there are lessons to read", () => {
    expect(founderReviewTodo({ title: "3S", partLabel: "Sweep" }, 5)).toEqual({
      title: "Review next week's lean module: 3S — Sweep", url: "/lean-review?week=next",
    });
  });

  it("asks for the lessons to be written when there are none", () => {
    expect(founderReviewTodo({ title: "3S", partLabel: "Sweep" }, 0)).toEqual({
      title: "Write next week's lean lessons: 3S — Sweep", url: "/lean-curriculum",
    });
  });
});
