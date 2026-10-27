import { describe, it, expect } from "vitest";
import { isIdea, needsReview, feedShownCount, FEED_PAGE_SIZE, unseenFilterIds } from "./improvement-review";

// "Not seen yet" filter, back by request (27 Oct 2026).
describe("the 'Not seen yet' filter", () => {
  const item = (id: number, stage: string, seenByMe: boolean, submittedByMe = false) =>
    ({ id, stage, seenByMe, submittedByMe, isMine: submittedByMe });

  it("shows exactly what the nav badge counts: unseen finished improvements someone else logged", () => {
    const ids = unseenFilterIds(new Set(), [
      item(1, "approved", false),
      item(2, "approved", true), // seen
      item(3, "todo", false), // an idea
      item(4, "waiting", false, true), // my own
      item(5, "sent_back", false),
    ]);
    expect([...ids].sort()).toEqual([1, 5]);
  });

  it("keeps a card on the list once it's been seen, so it doesn't vanish under the reader", () => {
    const kept = unseenFilterIds(new Set(), [item(1, "approved", false), item(2, "approved", false)]);
    const after = unseenFilterIds(kept, [item(1, "approved", true), item(2, "approved", false)]);
    expect([...after].sort()).toEqual([1, 2]);
    expect(after).toBe(kept); // nothing new joined — same set back
  });

  it("adds a new unseen one that arrives while the filter is on", () => {
    const kept = new Set([1]);
    expect([...unseenFilterIds(kept, [item(1, "approved", true), item(9, "approved", false)])].sort())
      .toEqual([1, 9]);
  });
});

describe("needsReview", () => {
  it("ideas never need reviewing, seen or not", () => {
    expect(needsReview({ stage: "todo", seenByMe: false, isMine: false })).toBe(false);
    expect(isIdea({ stage: "todo" })).toBe(true);
  });
  it("an unseen finished improvement from someone else does", () => {
    for (const stage of ["waiting", "approved", "sent_back"]) {
      expect(needsReview({ stage, seenByMe: false, isMine: false })).toBe(true);
    }
  });
  it("not once seen, and never my own", () => {
    expect(needsReview({ stage: "approved", seenByMe: true, isMine: false })).toBe(false);
    expect(needsReview({ stage: "approved", seenByMe: false, isMine: true })).toBe(false);
  });
});

// The server's badge rule, imported straight from its source so the two
// can't drift (this test file is outside the app's typecheck).
import {
  ALL_IMPROVEMENT_STATUSES, UNSEEN_COUNT_STATUSES, countsAsUnseen, stageOf,
} from "../../../../lib/db/src/improvement-stage";

describe("the feed's 'needs review' is exactly the nav badge's rule (24 Oct)", () => {
  const ME = 2;
  it("logged by someone else but credited/assigned to me: the badge counts it, so the feed must offer it", () => {
    const row = { progressStatus: "complete", submittedBy: 13 };
    expect(countsAsUnseen(row, ME, false)).toBe(true);
    expect(needsReview({ stage: "approved", seenByMe: false, submittedByMe: false, isMine: true })).toBe(true);
  });
  it("logged by me but credited to someone else: the badge doesn't count it, so no NEW in the feed", () => {
    expect(countsAsUnseen({ progressStatus: "complete", submittedBy: ME }, ME, false)).toBe(false);
    expect(needsReview({ stage: "approved", seenByMe: false, submittedByMe: true, isMine: false })).toBe(false);
  });
  it("agrees on every status × who logged it × seen-since-done", () => {
    for (const status of ALL_IMPROVEMENT_STATUSES) {
      for (const submittedBy of [ME, 13, null]) {
        for (const seen of [true, false]) {
          const server = countsAsUnseen({ progressStatus: status, submittedBy }, ME, seen);
          const client = needsReview({
            stage: stageOf(status), seenByMe: seen, submittedByMe: submittedBy === ME,
            // isMine deliberately the OPPOSITE guess — it must not matter.
            isMine: submittedBy !== ME,
          });
          expect({ status, submittedBy, seen, client }).toEqual({ status, submittedBy, seen, client: server });
        }
      }
    }
  });
  it("the SQL's status list is exactly the finished statuses", () => {
    expect([...UNSEEN_COUNT_STATUSES].sort()).toEqual(["awaiting_approval", "complete", "rejected"]);
  });
  it("an older server without submittedByMe falls back to isMine", () => {
    expect(needsReview({ stage: "approved", seenByMe: false, isMine: true })).toBe(false);
    expect(needsReview({ stage: "approved", seenByMe: false, isMine: false })).toBe(true);
  });
});

describe("feed shows 10 at a time (2026-10-02)", () => {
  it("shows what's been scrolled to, capped at the total", () => {
    expect(feedShownCount(111, FEED_PAGE_SIZE, -1)).toBe(10);
    expect(feedShownCount(111, 20, -1)).toBe(20);
    expect(feedShownCount(5, 10, -1)).toBe(5);
  });
  it("always reaches the oldest unseen improvement", () => {
    expect(feedShownCount(111, 10, 14)).toBe(15);
  });
  it("doesn't shrink back once that one is seen (the page passes what it already shows) — 24 Oct", () => {
    const shown = feedShownCount(111, 10, 14); // 15 on screen
    expect(feedShownCount(111, Math.max(10, shown), -1)).toBe(15);
  });});
