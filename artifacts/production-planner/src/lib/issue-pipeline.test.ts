import { describe, it, expect } from "vitest";
import { safeTestPath, tabCount, noticeStatusLine, batchedNoticeCopy, cardActions, withReplySent, type FixQueueItem } from "./issue-pipeline";

describe("safeTestPath", () => {
  it("keeps in-app paths", () => {
    expect(safeTestPath("/recipes")).toBe("/recipes");
    expect(safeTestPath(" /plans/12/station/ovens?tab=q ")).toBe("/plans/12/station/ovens?tab=q");
  });
  it("drops anything that could leave the app", () => {
    expect(safeTestPath(null)).toBeNull();
    expect(safeTestPath("")).toBeNull();
    expect(safeTestPath("https://evil.example")).toBeNull();
    expect(safeTestPath("//evil.example")).toBeNull();
    expect(safeTestPath("/\\evil.example")).toBeNull();
    expect(safeTestPath("/javascript:alert(1)")).toBeNull();
    expect(safeTestPath("recipes")).toBeNull();
  });
});

describe("tabCount", () => {
  const counts = { proposed: 3, approved: 1, rejected: 2, in_progress: 0, fixed: 4, wont_fix: 1, awaitingReply: 1 };
  it("reads each tab's count, folding won't-fix into Rejected", () => {
    expect(tabCount({ counts: counts }, "proposed")).toBe(2);
    expect(tabCount({ counts: counts }, "rejected")).toBe(3);
    expect(tabCount(undefined, "fixed")).toBe(0);
  });
  it("Done counts fixed and answered-by-message together", () => {
    expect(tabCount({ counts: { ...counts, fixed: 4, answered: 2 } as typeof counts & { answered: number } }, "fixed")).toBe(6);
    expect(tabCount({ counts: { ...counts, fixed: 1, answered: 1, dismissed: 3 } as typeof counts & { answered: number; dismissed: number } }, "fixed")).toBe(5);
  });
  it("prefers the server's per-tab counts", () => {
    expect(tabCount({ counts, tabCounts: { proposed: 4, in_progress: 5, snoozed: 2 } }, "in_progress")).toBe(5);
    expect(tabCount({ counts, tabCounts: { snoozed: 2 } }, "snoozed")).toBe(2);
  });
  it("To review leaves out cards waiting on Claude's answer to a reply", () => {
    expect(tabCount({ counts: { ...counts, proposed: 2, awaitingReply: 2 } }, "proposed")).toBe(0);
    expect(tabCount({ counts: { ...counts, proposed: 0, awaitingReply: 1 } }, "proposed")).toBe(0);
  });
});

describe("noticeStatusLine", () => {
  it("says whether the reporter has seen it and what they chose", () => {
    expect(noticeStatusLine({ ackAction: null, acknowledgedAt: null })).toMatch(/not seen yet/);
    expect(noticeStatusLine({ ackAction: "test_now", acknowledgedAt: "2026-09-24T10:00:00Z" })).toMatch(/testing it now/);
    expect(noticeStatusLine({ ackAction: "later", acknowledgedAt: "2026-09-24T10:00:00Z" })).toMatch(/will test later/);
  });
  it("a message to the reporter says whether they've read it", () => {
    expect(noticeStatusLine({ kind: "message", ackAction: null, acknowledgedAt: null })).toMatch(/Your message — not seen yet/);
    expect(noticeStatusLine({ kind: "message", ackAction: "later", acknowledgedAt: "2026-09-24T10:00:00Z" })).toMatch(/has read it/);
  });
});

describe("batchedNoticeCopy", () => {
  it("all fixes", () => {
    expect(batchedNoticeCopy([{ kind: "fixed" }, { kind: "fixed" }, { kind: "fixed" }])).toEqual({ heading: "3 of your reports have been fixed", button: "Got it — I'll test them" });
  });
  it("all replies", () => {
    expect(batchedNoticeCopy([{ kind: "message" }, { kind: "message" }])).toEqual({ heading: "2 replies to your reports", button: "Got it" });
  });
  it("a mix", () => {
    expect(batchedNoticeCopy([{ kind: "message" }, { kind: "fixed" }])).toEqual({ heading: "Updates on 2 of your reports", button: "Got it — I'll test it" });
  });
});

describe("cardActions — the right action in the right place", () => {
  const base = { status: "proposed" as const, questionForGraeme: null, awaitingRetriage: false, noActionNeeded: false };
  it("a settled proposal can be approved", () => {
    const a = cardActions(base);
    expect(a.canApprove).toBe(true);
    expect(a.approveBlocked).toBe(false);
  });
  it("no Approve while Claude is still asking — reply instead", () => {
    const a = cardActions({ ...base, questionForGraeme: "Fixed or tapped?" });
    expect(a.canApprove).toBe(false);
    expect(a.approveBlocked).toBe(true);
    expect(a.openQuestion).toBe(true);
    expect(a.canReply).toBe(true);
  });
  it("no Approve or Reply while Claude is working on your reply", () => {
    const a = cardActions({ ...base, awaitingRetriage: true });
    expect(a.canApprove).toBe(false);
    expect(a.canReply).toBe(false);
    expect(a.waitingOnClaude).toBe(true);
  });
  it("already done offers Dismiss, never Approve", () => {
    const a = cardActions({ ...base, noActionNeeded: true });
    expect(a.canDismiss).toBe(true);
    expect(a.canApprove).toBe(false);
    expect(a.approveBlocked).toBe(false);
  });
  it("closed cards offer nothing", () => {
    const a = cardActions({ ...base, status: "fixed" as never });
    expect([a.canApprove, a.canDismiss, a.canReply, a.canReject]).toEqual([false, false, false, false]);
  });
  // Regression (Graeme, 2026-10-12): no way to talk back to Claude unless it asked.
  it("Reply to Claude is on every card, whatever its state", () => {
    for (const status of ["proposed", "approved", "rejected", "in_progress", "fixed", "wont_fix", "answered", "dismissed"] as const) {
      for (const awaitingRetriage of [false, true]) {
        const a = cardActions({ ...base, status, awaitingRetriage });
        expect(a.canReplyToClaude).toBe(true);
        expect(a.replyReopens).toBe(status !== "proposed");
      }
    }
  });
});

describe("withReplySent — the card right after Reply to Claude", () => {
  const item = {
    triage: {
      id: 9, andonIssueId: 318, status: "approved", awaitingRetriage: false, snoozedUntil: "2026-10-20T00:00:00Z",
      noActionAt: null, noActionBy: null, decisionNote: null, decidedAt: null,
    },
    issue: null, notices: [], related: [],
    thread: [{ at: "2026-10-11T09:00:00Z", who: "claude", kind: "recommendation", text: "Not a bug" }],
  } as unknown as FixQueueItem;
  it("is back with Claude, shows your words, and keeps the earlier thread", () => {
    const now = new Date("2026-10-12T10:00:00Z");
    const out = withReplySent(item, "Your understanding is wrong — it's the wrapping count", now);
    expect(out.triage.status).toBe("proposed");
    expect(out.triage.awaitingRetriage).toBe(true);
    expect(out.triage.snoozedUntil).toBeNull();
    expect(out.triage.decisionNote).toBe("Your understanding is wrong — it's the wrapping count");
    expect(out.thread).toHaveLength(2);
    expect(out.thread![1]).toEqual({ at: now.toISOString(), who: "you", kind: "reply", text: "Your understanding is wrong — it's the wrapping count" });
    expect(cardActions(out.triage).waitingOnClaude).toBe(true);
    // The original is untouched (it's the rollback copy).
    expect(item.thread).toHaveLength(1);
    expect(item.triage.status).toBe("approved");
  });
});
