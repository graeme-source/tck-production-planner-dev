import { describe, it, expect } from "vitest";
import {
  answerReady,
  inDailyWindow,
  isDue,
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
  isReporter: false, startedAt: null, snoozedUntil: null, createdAt: "2026-10-10T08:00:00Z", ...over,
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

describe("pickTestToShow", () => {
  const now = at("2026-10-10T13:30:00Z");
  it("skips put-off ones until their time is up", () => {
    const snoozed = req({ id: 1, snoozedUntil: "2026-10-10T15:00:00Z" });
    expect(pickTestToShow([snoozed], now, "/")).toBeNull();
    expect(pickTestToShow([snoozed], at("2026-10-10T15:01:00Z"), "/")?.id).toBe(1);
  });
  it("shows a started one before a new one", () => {
    const fresh = req({ id: 1 });
    const started = req({ id: 2, startedAt: "2026-10-10T13:00:00Z" });
    expect(pickTestToShow([fresh, started], now, "/")?.id).toBe(2);
  });
  it("skips ones not due here", () => {
    const building = req({ id: 1, onlyOnPath: "/plans/*/station/building" });
    const anywhere = req({ id: 2 });
    expect(pickTestToShow([building, anywhere], now, "/")?.id).toBe(2);
    expect(pickTestToShow([], now, "/")).toBeNull();
    expect(pickTestToShow(undefined, now, "/")).toBeNull();
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
  it("lists the reporter first, always, without repeats", () => {
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
