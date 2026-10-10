import { describe, it, expect } from "vitest";
import {
  answerReady,
  cardWanted,
  inDailyWindow,
  isDue,
  needsAutoTodo,
  openedTestId,
  onLinkedPage,
  pathMatches,
  pickTestToShow,
  shouldShowTestCard,
  testerPreview,
  whenSummary,
  type MyTestRequest,
} from "./test-requests";

const req = (over: Partial<MyTestRequest> = {}): MyTestRequest => ({
  id: 1, title: "Edit numbers", steps: "Tap Edit numbers", linkPath: null, onlyOnPath: null, notBefore: null,
  dailyFrom: null, dailyUntil: null, whenText: null, createdByName: "Graeme", andonIssueId: null, issueDescription: null,
  improvementId: null, improvementTitle: null,
  isReporter: false, startedAt: null, promptedAt: null, todoTaskId: null, createdAt: "2026-10-10T08:00:00Z", ...over,
});

// 2026-10-10 is BST (UTC+1): 13:30Z = 14:30 London.
const at = (iso: string) => new Date(iso);

describe("pathMatches", () => {
  it("matches a star as any one part", () => {
    expect(pathMatches("/plans/*/station/building", "/plans/412/station/building")).toBe(true);
    expect(pathMatches("/plans/*/station/building", "/plans/412/station/wrapping")).toBe(false);
    expect(pathMatches("/plans/*/station/building", "/plans/412")).toBe(false);
  });
  it("ignores the query and a trailing slash", () => {
    expect(pathMatches("/fulfilment", "/fulfilment/?tab=x")).toBe(true);
  });
});

describe("inDailyWindow (London time)", () => {
  it("after 2pm", () => {
    expect(inDailyWindow("14:00", null, at("2026-10-10T13:30:00Z"))).toBe(true);
    expect(inDailyWindow("14:00", null, at("2026-10-10T12:30:00Z"))).toBe(false);
  });
  it("between, and overnight", () => {
    expect(inDailyWindow("07:00", "11:00", at("2026-10-10T07:00:00Z"))).toBe(true); // 08:00
    expect(inDailyWindow("07:00", "11:00", at("2026-10-10T10:00:00Z"))).toBe(false); // 11:00
    expect(inDailyWindow("22:00", "06:00", at("2026-10-10T22:30:00Z"))).toBe(true); // 23:30
    expect(inDailyWindow("22:00", "06:00", at("2026-10-10T11:00:00Z"))).toBe(false);
  });
  it("no window = any time", () => {
    expect(inDailyWindow(null, null, at("2026-10-10T03:00:00Z"))).toBe(true);
  });
});

describe("isDue", () => {
  const now = at("2026-10-10T13:30:00Z");
  it("any time, anywhere when it has no conditions", () => {
    expect(isDue(req(), now, "/")).toBe(true);
  });
  it("waits for its date", () => {
    expect(isDue(req({ notBefore: "2026-10-11T05:00:00Z" }), now, "/")).toBe(false);
    expect(isDue(req({ notBefore: "2026-10-10T05:00:00Z" }), now, "/")).toBe(true);
  });
  it("waits for the right station — 'next time you build'", () => {
    const r = req({ onlyOnPath: "/plans/*/station/building" });
    expect(isDue(r, now, "/")).toBe(false);
    expect(isDue(r, now, "/plans/9/station/building")).toBe(true);
  });
  it("follows them anywhere once they've started", () => {
    const r = req({ onlyOnPath: "/plans/*/station/building", dailyFrom: "20:00", startedAt: "2026-10-10T13:00:00Z" });
    expect(isDue(r, now, "/hub")).toBe(true);
  });
});

const ctx = (over: Partial<{ now: Date; path: string; openedId: number | null; shownThisLoad: Set<number> }> = {}) => ({
  now: at("2026-10-10T13:30:00Z"), path: "/", openedId: null, shownThisLoad: new Set<number>(), ...over,
});

describe("cardWanted — no nagging", () => {
  it("a test with no place pops up once: before it's been shown", () => {
    expect(cardWanted(req(), ctx())).toBe(true);
  });
  it("…and stays up for the rest of that page load, but never comes back after", () => {
    const shown = req({ promptedAt: "2026-10-10T13:00:00Z" });
    expect(cardWanted(shown, ctx({ shownThisLoad: new Set([1]) }))).toBe(true);
    expect(cardWanted(shown, ctx())).toBe(false);
  });
  it("a test tied to a place pops up each time they arrive there — not anywhere else, not on a timer", () => {
    const r = req({ onlyOnPath: "/plans/*/station/fried-chicken", promptedAt: "2026-10-07T09:00:00Z" });
    expect(cardWanted(r, ctx({ path: "/" }))).toBe(false);
    expect(cardWanted(r, ctx({ path: "/plans/88/station/fried-chicken" }))).toBe(true);
  });
  it("once it's on their to-do list it never pops up again — anywhere", () => {
    const r = req({ todoTaskId: 5, onlyOnPath: "/plans/*/station/building" });
    expect(cardWanted(r, ctx({ path: "/plans/9/station/building" }))).toBe(false);
    expect(cardWanted(req({ todoTaskId: 5 }), ctx())).toBe(false);
  });
  it("…unless they open it from that to-do", () => {
    expect(cardWanted(req({ todoTaskId: 5 }), ctx({ openedId: 1 }))).toBe(true);
  });
  it("waits for its date and time", () => {
    expect(cardWanted(req({ notBefore: "2026-10-11T05:00:00Z" }), ctx())).toBe(false);
    expect(cardWanted(req({ dailyFrom: "16:00" }), ctx())).toBe(false);
  });
  it("follows them as the Testing bar once they've started", () => {
    expect(cardWanted(req({ startedAt: "2026-10-10T13:00:00Z", promptedAt: "2026-10-10T13:00:00Z", onlyOnPath: "/plans/*/station/building" }), ctx({ path: "/hub" }))).toBe(true);
  });
});

describe("pickTestToShow", () => {
  it("shows the one they opened first, then a started one, then the oldest", () => {
    const a = req({ id: 1 }), b = req({ id: 2, startedAt: "2026-10-10T13:00:00Z" }), c = req({ id: 3, todoTaskId: 9 });
    expect(pickTestToShow([a, b, c], ctx({ openedId: 3 }))?.id).toBe(3);
    expect(pickTestToShow([a, b, c], ctx())?.id).toBe(2);
    expect(pickTestToShow([a], ctx())?.id).toBe(1);
    expect(pickTestToShow([], ctx())).toBeNull();
    expect(pickTestToShow(undefined, ctx())).toBeNull();
  });
});

describe("needsAutoTodo", () => {
  it("a no-place test shown before and never dealt with goes on the to-do list instead of returning", () => {
    expect(needsAutoTodo(req({ promptedAt: "2026-10-09T09:00:00Z" }), new Set())).toBe(true);
  });
  it("not while it's still on screen, not for place tests, not once on the list or started", () => {
    const r = req({ promptedAt: "2026-10-09T09:00:00Z" });
    expect(needsAutoTodo(r, new Set([1]))).toBe(false);
    expect(needsAutoTodo(req({ promptedAt: "x", onlyOnPath: "/fulfilment" }), new Set())).toBe(false);
    expect(needsAutoTodo(req({ promptedAt: "x", todoTaskId: 4 }), new Set())).toBe(false);
    expect(needsAutoTodo(req({ promptedAt: "x", startedAt: "x" }), new Set())).toBe(false);
    expect(needsAutoTodo(req(), new Set())).toBe(false);
  });
});

describe("openedTestId", () => {
  it("reads the to-do link", () => {
    expect(openedTestId("?testRequest=42")).toBe(42);
    expect(openedTestId("testRequest=7&x=1")).toBe(7);
    expect(openedTestId("?testRequest=abc")).toBeNull();
    expect(openedTestId("")).toBeNull();
  });
});

describe("shouldShowTestCard", () => {
  const base = { request: req(), pinLocked: false, otherPromptShowing: false, path: "/" };
  it("shows when there's one to ask and nothing else in the way", () => {
    expect(shouldShowTestCard(base)).toBe(true);
  });
  it("waits for the PIN pad and other pop-ups", () => {
    expect(shouldShowTestCard({ ...base, pinLocked: true })).toBe(false);
    expect(shouldShowTestCard({ ...base, otherPromptShowing: true })).toBe(false);
  });
  it("never on the visitor kiosk", () => {
    expect(shouldShowTestCard({ ...base, path: "/visitor-check-in" })).toBe(false);
  });
  it("nothing to ask, nothing shown", () => {
    expect(shouldShowTestCard({ ...base, request: null })).toBe(false);
  });
});

describe("words", () => {
  it("knows when you're already on the linked page", () => {
    expect(onLinkedPage("/plans/9/station/building", "/plans/9/station/building")).toBe(true);
    expect(onLinkedPage("/plans/9/station/building", "/")).toBe(false);
    expect(onLinkedPage(null, "/")).toBe(false);
  });
  it("says when in plain words", () => {
    expect(whenSummary(req({ whenText: "Next time you build" }))).toBe("Next time you build");
    expect(whenSummary(req({ dailyFrom: "14:00" }))).toBe("after 14:00");
    expect(whenSummary(req({ dailyFrom: "07:00", dailyUntil: "11:00", onlyOnPath: "/plans/*/station/building" }))).toBe("between 07:00 and 11:00, on /plans/…/station/building");
    expect(whenSummary(req())).toBe("Any time");
  });
  it("lists the issue reporter and idea submitter first, always, without repeats", () => {
    expect(testerPreview([{ id: 7, name: "Ana" }, { id: 8, name: "Cy" }, null], [{ id: 8, name: "Cy" }])).toEqual([
      { id: 7, name: "Ana", isReporter: true },
      { id: 8, name: "Cy", isReporter: true },
    ]);
    expect(testerPreview({ id: 7, name: "Ana" }, [{ id: 3, name: "Ben" }, { id: 7, name: "Ana" }])).toEqual([
      { id: 7, name: "Ana", isReporter: true },
      { id: 3, name: "Ben", isReporter: false },
    ]);
    expect(testerPreview(null, [{ id: 3, name: "Ben" }])).toEqual([{ id: 3, name: "Ben", isReporter: false }]);
  });
  it("needs a reason before a can't-test answer can be sent", () => {
    expect(answerReady(null, "")).toBe(false);
    expect(answerReady("works_easy", "")).toBe(true);
    expect(answerReady("cant_test", " ")).toBe(false);
    expect(answerReady("cant_test", "Not on shift")).toBe(true);
  });
});
