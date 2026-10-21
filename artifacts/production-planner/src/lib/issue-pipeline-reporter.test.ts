/** Issue #323 (Graeme, 2026-10-13): messaging the reporter keeps the card. */
import { describe, it, expect } from "vitest";
import {
  QUEUE_TAB_LABELS, cardActions, chatFirstName, chatLine, clockLabel, newReporterWords, noticeChat, unreadLabel, waitingForReporterLabel, withMessageSent, withThreadRead,
  type FixQueueItem, type ThreadEntry,
} from "./issue-pipeline";

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
      { at: "4", who: "reporter", kind: "read", text: "Read your message" },
      { at: "5", who: "reporter", kind: "reply", text: "A2" },
    ];
    // A "Got it" read receipt is not a reply (21 Oct 2026).
    expect(newReporterWords(thread).map(e => e.text)).toEqual(["A2"]);
    expect(newReporterWords(thread.slice(0, 4))).toEqual([]);
    expect(newReporterWords([])).toEqual([]);
  });
});

// Graeme, 21 Oct 2026: "show the conversational history like I can with
// Claude" — one chat, Jane named, his private notes to Claude marked.
describe("chatLine — one conversation on the card", () => {
  it("the reporter's words are a bubble with their first name", () => {
    expect(chatLine({ at: "1", who: "reporter", kind: "reply", text: "Only XXL" }, "Jane"))
      .toEqual({ side: "left", tone: "reporter", label: "Jane", text: "Only XXL" });
  });
  it("a Got it is a small note, not a reply", () => {
    expect(chatLine({ at: "1", who: "reporter", kind: "read", text: "Read your message" }, "Jane"))
      .toMatchObject({ side: "centre", tone: "note", text: "Jane — read your message" });
  });
  it("Graeme to Jane vs Graeme to Claude are told apart", () => {
    expect(chatLine({ at: "1", who: "you", kind: "message", text: "Why?" }, "Jane").label).toBe("You → Jane");
    expect(chatLine({ at: "1", who: "you", kind: "reply", text: "Hold off" }, "Jane").label).toBe("You → Claude (Jane doesn't see this)");
    expect(chatLine({ at: "1", who: "you", kind: "decision", text: "Approved" }, "Jane").side).toBe("centre");
  });
  it("Claude is on the left", () => {
    expect(chatLine({ at: "1", who: "claude", kind: "question", text: "Which tins?" }, "Jane")).toMatchObject({ side: "left", tone: "claude", label: "Claude asks you" });
  });
  it("unread label and marking read", () => {
    expect(unreadLabel("Jane", 1)).toBe("Jane replied");
    expect(unreadLabel("Jane", 3)).toBe("Jane replied · 3 new");
    const read = withThreadRead({ ...item, unreadReplies: 2, latestUnreadAt: "x" });
    expect(read.unreadReplies).toBe(0);
    // Reading never moves the card: the reply flag that holds it in To review stays.
    expect(read.triage.reporterReplyAt).toBe(item.triage.reporterReplyAt);
    expect(withMessageSent({ ...item, unreadReplies: 2 }, "Thanks", false).unreadReplies).toBe(0);
  });
});

// The reporter sees the conversation where they reply (21 Oct 2026).
describe("noticeChat — the reporter's pop-up shows the conversation so far", () => {
  const convo = [
    { id: 1, at: "1", who: "them" as const, name: "Graeme Carter", text: "Which suppliers?" },
    { id: 2, at: "2", who: "me" as const, name: "You", text: "Puffin and Macfarlane" },
    { id: 3, at: "3", who: "them" as const, name: "Graeme Carter", text: "Any others?" },
  ];
  it("earlier messages above Graeme's newest one", () => {
    expect(noticeChat(convo, "Any others?")).toEqual({ earlier: convo.slice(0, 2), latest: "Any others?" });
  });
  it("first message: nothing earlier", () => {
    expect(noticeChat(convo.slice(0, 1), "Which suppliers?").earlier).toEqual([]);
  });
  it("no conversation loaded (older server): just the message", () => {
    expect(noticeChat(undefined, "Hi")).toEqual({ earlier: [], latest: "Hi" });
  });
  it("first names for headings", () => {
    expect(chatFirstName("Graeme Carter")).toBe("Graeme");
    expect(chatFirstName("You")).toBe("You");
  });
});

it("Done is what the Fix queue calls the fixed tab", () => {
  expect(QUEUE_TAB_LABELS.fixed).toBe("Done");
});
