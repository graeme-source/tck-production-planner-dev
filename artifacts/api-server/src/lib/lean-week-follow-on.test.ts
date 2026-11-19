import { describe, expect, it } from "vitest";
import { followOnDetail, followOnWeek, mondaysFrom, planRunsOut, plannedWeek, suggestNextSubject, type PlanWeek } from "./lean-week-follow-on";

const week = (id: number, status = "locked", lessonCount = 5): PlanWeek => ({ id, status, lessonCount });

describe("followOnWeek", () => {
  const plan = [week(1), week(2), week(10), week(11), week(12)];

  it("carries on to the next week in the plan", () => {
    expect(followOnWeek(plan, 10, 1)?.id).toBe(11);
    expect(followOnWeek(plan, 10, 2)?.id).toBe(12);
  });

  it("wraps round to the start when the plan runs out", () => {
    expect(followOnWeek(plan, 10, 3)?.id).toBe(1);
  });

  it("steps over a week with no lessons written", () => {
    expect(followOnWeek([week(10), week(11, "locked", 0), week(12)], 10, 1)?.id).toBe(12);
  });

  it("still starts from a pinned week that has no lessons", () => {
    expect(followOnWeek([week(1), week(10, "draft", 0), week(2)], 10, 1)?.id).toBe(2);
  });

  it("leaves it to the calendar when the pinned week isn't in the plan", () => {
    expect(followOnWeek(plan, 99, 1)).toBeNull();
  });
});

describe("plannedWeek", () => {
  // Live on 9 Nov 2026: 3S overview pinned, its other weeks and Leave it better
  // not written yet. The meeting wraps round to Seeing Waste, but the plan's
  // next week is still Sweep, and that's what the founder must write.
  const live = [week(5162), week(5170), week(5171, "draft"), week(5172, "draft", 0), week(5173, "draft", 0), week(5175, "draft", 0)];

  it("names the next week in the plan even when it isn't written", () => {
    expect(followOnWeek(live, 5171, 1)?.id).toBe(5162);
    expect(plannedWeek(live, 5171, 1)?.id).toBe(5172);
    expect(plannedWeek(live, 5171, 2)?.id).toBe(5173);
  });

  it("agrees with the meeting once the week is written", () => {
    const written = [week(1), week(10), week(11)];
    expect(plannedWeek(written, 10, 1)?.id).toBe(followOnWeek(written, 10, 1)?.id);
  });

  it("wraps round the plan", () => {
    expect(plannedWeek(live, 5175, 1)?.id).toBe(5162);
  });

  it("leaves it to the calendar when the pinned week isn't in the plan", () => {
    expect(plannedWeek(live, 99, 1)).toBeNull();
  });
});

describe("only ready weeks are taught (19 Nov 2026)", () => {
  it("steps over a written draft — it's taught once it's locked in", () => {
    expect(followOnWeek([week(10), week(11, "draft"), week(12)], 10, 1)?.id).toBe(12);
  });
  it("live 19 Nov: Sweep pinned for 23 Nov, then Sort, Standardise, Leave it better, then it runs out", () => {
    const live = [week(5162), week(5170), week(5171), week(5172), week(5173), week(5174), week(5175)];
    expect(followOnDetail(live, 5172, 1)).toEqual({ week: week(5173), wrapped: false });
    expect(followOnDetail(live, 5172, 3)).toEqual({ week: week(5175), wrapped: false });
    expect(followOnDetail(live, 5172, 4)).toEqual({ week: week(5162), wrapped: true });
  });
});

describe("suggestNextSubject — what to put in when the plan runs out", () => {
  const subj = (id: number, title: string, sortOrder: number, audience = "team", isArchived = false) => ({ id, title, sortOrder, audience, isArchived });
  const subjects = [
    subj(1, "Overproduction", 1), subj(9, "Waste", 9), subj(10, "Improve the process", 10),
    subj(11, "3S", 11), subj(12, "Leave it better than you found it", 12), subj(13, "Total Ownership", 13),
    subj(14, "Improvement Time", 14), subj(19, "It Starts With The Leaders", 19, "leaders"),
  ];
  const plan = [
    { subjectId: null, title: "Seeing Waste — What Waste Really Is" },
    { subjectId: null, title: "The 8 Wastes — Overproduction" },
    { subjectId: 11, title: "3S" },
    { subjectId: 12, title: "Leave it better than you found it" },
  ];
  it("picks the next team subject after the furthest one planned — Total Ownership", () => {
    expect(suggestNextSubject(subjects, plan)?.title).toBe("Total Ownership");
  });
  it("moves on once that's planned too", () => {
    expect(suggestNextSubject(subjects, [...plan, { subjectId: 13, title: "Total Ownership" }])?.title).toBe("Improvement Time");
  });
  it("never suggests a leaders' subject or an archived one", () => {
    expect(suggestNextSubject([subj(19, "Leaders", 19, "leaders"), subj(20, "Old", 20, "team", true)], [])).toBeNull();
  });
});

describe("planRunsOut — keep two weeks ahead", () => {
  const sched = (w: boolean[]) => mondaysFrom("2026-12-07", w.length).map((weekStart, i) => ({ weekStart, wrapped: w[i] }));
  it("flags the plan running out this week or within the next two", () => {
    expect(planRunsOut(sched([false, false, true, true]))).toBe("2026-12-21");
    expect(planRunsOut(sched([false, true]))).toBe("2026-12-14");
  });
  it("is quiet while three weeks or more are ready", () => {
    expect(planRunsOut(sched([false, false, false, true]))).toBeNull();
  });
});

describe("mondaysFrom", () => {
  it("steps a week at a time across a month end", () => {
    expect(mondaysFrom("2026-11-23", 3)).toEqual(["2026-11-23", "2026-11-30", "2026-12-07"]);
  });
});
