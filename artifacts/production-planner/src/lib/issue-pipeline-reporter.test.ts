/** Issue #323 (Graeme, 2026-10-13): messaging the reporter keeps the card. */
import { describe, it, expect } from "vitest";
import { QUEUE_TAB_LABELS, cardActions, clockLabel, newReporterWords, waitingForReporterLabel, withMessageSent, type FixQueueItem, type ThreadEntry } from "./issue-pipeline";

const item = {
  triage: {
    id: 87, andonIssueId: 323, status: "proposed", awaitingRetriage: false, questionForGraeme: null, noActionNeeded: false,
    awaitingReporterSince: null, reporterReplyAt: "2026-10-13T11:00:00Z", decisionNote: null, decidedAt: null, issueResolvedAt: null,
  },
  issue: null, notices: [], related: [],
  thread: [{ at: "2026-10-13T11:05:40Z", who: "claude", kind: "recommendation", text: "Hide the XXL label" }],
} as unknown as FixQueueItem;

describe("withMessageSent", () => {
  const now = new Date("2026-10-13T11:09:00Z");
  it("Message <name>: same status, waiting for them, reply marked seen, words on the thread", () => {
    const out = withMessageSent(item, "Only XXL tins? Why?", false, now);
    expect(out.triage.status).toBe("proposed");
    expect(out.triage.issueResolvedAt).toBeNull();
    expect(out.triage.awaitingReporterSince).toBe(now.toISOString());
    expect(out.triage.reporterReplyAt).toBeNull();
    expect(out.thread!.at(-1)).toEqual({ at: now.toISOString(), who: "you", kind: "message", text: "Only XXL tins? Why?" });
    // Reply to Claude is still offered while waiting for the reporter.
    expect(cardActions(out.triage).canReplyToClaude).toBe(true);
    expect(item.thread).toHaveLength(1);
  });
  it("Send and close: answered, no longer waiting", () => {
    const out = withMessageSent(item, "Done — thanks", true, now);
    expect(out.triage.status).toBe("answered");
    expect(out.triage.awaitingReporterSince).toBeNull();
  });
});

describe("waitingForReporterLabel", () => {
  const now = new Date("2026-10-13T15:00:00Z");
  it("shows the London time it was asked today", () => {
    // 11:09 UTC = 12:09 BST
    expect(waitingForReporterLabel({ awaitingReporterSince: "2026-10-13T11:09:00Z" }, "Jane", now)).toBe("Waiting for Jane's reply · asked 12:09");
  });
  it("shows the day for an older question", () => {
    expect(clockLabel("2026-10-12T11:09:00Z", now)).toBe("Mon 12 Oct, 12:09");
  });
  it("nothing when not waiting", () => {
    expect(waitingForReporterLabel({ awaitingReporterSince: null }, "Jane", now)).toBeNull();
  });
});

describe("newReporterWords", () => {
  it("only what the reporter said after Graeme's last message", () => {
    const thread: ThreadEntry[] = [
      { at: "1", who: "you", kind: "message", text: "Q1" },
      { at: "2", who: "reporter", kind: "reply", text: "A1" },
      { at: "3", who: "you", kind: "message", text: "Q2" },
      { at: "4", who: "reporter", kind: "decision", text: "Issue #323: read your message" },
      { at: "5", who: "reporter", kind: "reply", text: "A2" },
    ];
    expect(newReporterWords(thread).map(e => e.text)).toEqual(["Issue #323: read your message", "A2"]);
    expect(newReporterWords([])).toEqual([]);
  });
});

it("Done is what the Fix queue calls the fixed tab", () => {
  expect(QUEUE_TAB_LABELS.fixed).toBe("Done");
});
