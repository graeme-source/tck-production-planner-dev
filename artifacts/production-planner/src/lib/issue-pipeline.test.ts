import { describe, it, expect } from "vitest";
import { safeTestPath, tabCount, noticeStatusLine, batchedNoticeCopy, cardActions } from "./issue-pipeline";

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
});
