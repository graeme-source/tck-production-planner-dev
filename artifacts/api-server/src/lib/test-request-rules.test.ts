import { describe, it, expect } from "vitest";
import {
  answerNeedsFollowUp,
  answerNoteProblem,
  answerVerdict,
  followUpMessage,
  isHhMm,
  issueCommentFor,
  requestStatus,
  stillAsking,
  testersFor,
  testTodoTitle,
  testTodoUrl,
  todoPlan,
  validatePathPattern,
} from "./test-request-rules";

describe("testersFor — who must test it", () => {
  it("always includes the person who reported the issue, first", () => {
    const r = testersFor({ originIds: [7], chosenIds: [] });
    expect(r).toEqual({ ok: true, testers: [{ userId: 7, isReporter: true }] });
  });

  it("an improvement idea's submitter is asked by default too", () => {
    const r = testersFor({ originIds: [null, 12], chosenIds: [] });
    expect(r.ok && r.testers).toEqual([{ userId: 12, isReporter: true }]);
  });

  it("issue reporter and idea submitter both asked once each, then the chosen", () => {
    const r = testersFor({ originIds: [7, 7, 12], chosenIds: [3, 7, 12, 3, 9] });
    expect(r.ok && r.testers).toEqual([
      { userId: 7, isReporter: true },
      { userId: 12, isReporter: true },
      { userId: 3, isReporter: false },
      { userId: 9, isReporter: false },
    ]);
  });

  it("without an origin, uses the people chosen", () => {
    const r = testersFor({ originIds: [], chosenIds: [4] });
    expect(r.ok && r.testers).toEqual([{ userId: 4, isReporter: false }]);
  });

  it("refuses when nobody would be asked", () => {
    expect(testersFor({ originIds: [null], chosenIds: [] })).toEqual({ ok: false, error: "Choose who should test it" });
    expect(testersFor({ originIds: [], chosenIds: [0, -1] }).ok).toBe(false);
  });
});

describe("the tester's to-do", () => {
  it("is ticked when they answer and removed when the request is closed", () => {
    expect(todoPlan("answered", { status: "open" })).toBe("tick");
    expect(todoPlan("closed", { status: "open" })).toBe("delete");
  });
  it("is left alone once done, or when there isn't one", () => {
    expect(todoPlan("answered", { status: "done" })).toBe("none");
    expect(todoPlan("closed", { status: "done" })).toBe("none");
    expect(todoPlan("closed", null)).toBe("none");
  });
  it("links back to the test card", () => {
    expect(testTodoUrl(42)).toBe("/?testRequest=42");
    expect(testTodoTitle("Edit numbers")).toBe("Test: Edit numbers");
  });
});

describe("requestStatus — state from the answers", () => {
  const t = (answer: string | null, startedAt: string | null = null) => ({ answer, startedAt });

  it("waiting until anyone touches it", () => {
    expect(requestStatus({ closedAt: null, testers: [t(null), t(null)] })).toBe("waiting");
  });
  it("in progress once someone starts or answers", () => {
    expect(requestStatus({ closedAt: null, testers: [t(null, "2026-10-10T09:00:00Z")] })).toBe("in_progress");
    expect(requestStatus({ closedAt: null, testers: [t("works_easy"), t(null)] })).toBe("in_progress");
  });
  it("passed when everyone has answered and it works", () => {
    expect(requestStatus({ closedAt: null, testers: [t("works_easy")] })).toBe("passed");
    expect(requestStatus({ closedAt: null, testers: [t("works_easy"), t("cant_test")] })).toBe("passed");
  });
  it("problems as soon as anyone finds one — even before the others answer", () => {
    expect(requestStatus({ closedAt: null, testers: [t("works_confusing"), t(null)] })).toBe("problems");
    expect(requestStatus({ closedAt: null, testers: [t("works_easy"), t("doesnt_work")] })).toBe("problems");
  });
  it("skipped when nobody could test it", () => {
    expect(requestStatus({ closedAt: null, testers: [t("cant_test"), t("cant_test")] })).toBe("skipped");
  });
  it("closed beats everything", () => {
    expect(requestStatus({ closedAt: "2026-10-10T10:00:00Z", testers: [t("doesnt_work")] })).toBe("closed");
  });
});

describe("answering", () => {
  it("only the assigned person, only once, only while open", () => {
    expect(answerVerdict(null, null)).toMatchObject({ ok: false, status: 404 });
    expect(answerVerdict({ closedAt: null }, null)).toMatchObject({ ok: false, status: 403 });
    expect(answerVerdict({ closedAt: new Date() }, { answer: null })).toMatchObject({ ok: false, status: 409 });
    expect(answerVerdict({ closedAt: null }, { answer: "works_easy" })).toMatchObject({ ok: false, status: 409 });
    expect(answerVerdict({ closedAt: null }, { answer: null })).toEqual({ ok: true });
  });

  it("keeps asking until answered or closed", () => {
    expect(stillAsking({ closedAt: null }, { answer: null })).toBe(true);
    expect(stillAsking({ closedAt: null }, { answer: "doesnt_work" })).toBe(false);
    expect(stillAsking({ closedAt: new Date() }, { answer: null })).toBe(false);
    expect(stillAsking({ closedAt: null }, null)).toBe(false);
  });

  it("can't-test needs a reason; the others don't", () => {
    expect(answerNoteProblem("cant_test", "  ")).toMatch(/why/);
    expect(answerNoteProblem("cant_test", "Not on shift")).toBeNull();
    expect(answerNoteProblem("doesnt_work", null)).toBeNull();
  });

  it("tells the asker about everything except a clean pass", () => {
    expect(answerNeedsFollowUp("works_easy")).toBe(false);
    expect(answerNeedsFollowUp("works_confusing")).toBe(true);
    expect(answerNeedsFollowUp("doesnt_work")).toBe(true);
    expect(answerNeedsFollowUp("cant_test")).toBe(true);
  });

  it("writes plain words for the issue thread and the bell", () => {
    expect(issueCommentFor("Ana", "Edit numbers", "doesnt_work", " Total stayed at 0 ")).toBe(
      'Test result from Ana — "Edit numbers": Doesn\'t work.\nTotal stayed at 0',
    );
    expect(issueCommentFor("Ana", "Edit numbers", "works_easy", "")).toBe('Test result from Ana — "Edit numbers": Works and easy to understand.');
    expect(followUpMessage("Ana", "Edit numbers", "works_confusing")).toBe('Ana tested "Edit numbers": Works but confusing');
  });
});

describe("conditions", () => {
  it("checks HH:MM times", () => {
    expect(isHhMm("14:00")).toBe(true);
    expect(isHhMm("07:30")).toBe(true);
    expect(isHhMm("24:00")).toBe(false);
    expect(isHhMm("2pm")).toBe(false);
    expect(isHhMm(null)).toBe(false);
  });
  it("accepts in-app page patterns with whole-part stars only", () => {
    expect(validatePathPattern("/plans/*/station/building")).toBe("/plans/*/station/building");
    expect(validatePathPattern("/fulfilment")).toBe("/fulfilment");
    expect(validatePathPattern("/plans/1*/station")).toBeNull();
    expect(validatePathPattern("https://evil.example")).toBeNull();
    expect(validatePathPattern("/api/users")).toBeNull();
  });
});
