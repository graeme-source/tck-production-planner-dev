/**
 * Fix queue — the reporter's replies must be very obvious (Graeme, 21 Oct
 * 2026: "I don't think I can see Jane's replies to my messages to her").
 * Unread replies, list order, and what the reporter sees of the thread.
 */
import { describe, it, expect } from "vitest";
import { buildThread, reporterConversation, sortByReporterReplies, unreadReporterReplies } from "./issue-pipeline-rules";

// #336 as it happened on 20 Oct, plus the reply Jane could now write back.
const events = [
  { event: "triaged", note: null, createdAt: "2026-10-20T05:42:46Z", snapshot: { verdictSummary: "Hide the stock-check button on kanban lines" } },
  { event: "replied", note: "No button at all.", createdAt: "2026-10-20T07:10:38Z", snapshot: {} },
  { event: "approved_to_fix", note: null, createdAt: "2026-10-20T07:10:38Z", snapshot: {} },
  { event: "messaged_reporter", note: "Hi Jane, thanks - you're right…", createdAt: "2026-10-20T07:10:47Z", snapshot: {} },
  { event: "claude_note", note: "Built your way on branch fix/issue-336", createdAt: "2026-10-20T08:09:03Z", snapshot: {} },
  { event: "notice_ack", note: "Issue #336: read your message", createdAt: "2026-10-20T09:10:26Z", snapshot: {} },
  { event: "reporter_replied", note: "Thank you, that's perfect", createdAt: "2026-10-21T09:00:00Z", snapshot: {} },
];

describe("buildThread — one chronological conversation", () => {
  it("has Claude, Graeme (to Claude and to Jane) and Jane in time order; 'Got it' is a read receipt", () => {
    const t = buildThread(events);
    expect(t.map(e => [e.who, e.kind])).toEqual([
      ["claude", "recommendation"],
      ["you", "reply"],
      ["you", "decision"],
      ["you", "message"],
      ["claude", "message"],
      ["reporter", "read"],
      ["reporter", "reply"],
    ]);
    expect(t[5].text).toBe("Read your message");
  });
});

describe("unreadReporterReplies", () => {
  const thread = buildThread(events);
  it("never read: every typed reply is unread — a read receipt never is", () => {
    expect(unreadReporterReplies(thread, null).map(e => e.text)).toEqual(["Thank you, that's perfect"]);
  });
  it("read after the reply: nothing unread", () => {
    expect(unreadReporterReplies(thread, "2026-10-21T09:05:00Z")).toEqual([]);
  });
  it("read before the reply: the reply is unread", () => {
    expect(unreadReporterReplies(thread, "2026-10-20T12:00:00Z")).toHaveLength(1);
  });
  it("only read receipts (what Jane actually did on 20 Oct): nothing unread", () => {
    expect(unreadReporterReplies(buildThread(events.slice(0, 6)), null)).toEqual([]);
  });
});

describe("sortByReporterReplies — unread replies at the top", () => {
  const card = (id: number, unreadReplies = 0, latestUnreadAt: string | null = null, reporterReplyAt: string | null = null) =>
    ({ id, unreadReplies, latestUnreadAt, reporterReplyAt });
  it("unread (newest first), then answered-not-acted-on, then the rest in order", () => {
    const out = sortByReporterReplies([
      card(1),
      card(2, 0, null, "2026-10-21T08:00:00Z"),
      card(3, 1, "2026-10-21T08:00:00Z", "2026-10-21T08:00:00Z"),
      card(4),
      card(5, 2, "2026-10-21T09:00:00Z", "2026-10-21T09:00:00Z"),
    ]);
    expect(out.map(c => c.id)).toEqual([5, 3, 2, 1, 4]);
  });
  it("no replies anywhere: order unchanged", () => {
    expect(sortByReporterReplies([card(3), card(1), card(2)]).map(c => c.id)).toEqual([3, 1, 2]);
  });
});

describe("reporterConversation — what the reporter sees in their pop-up", () => {
  it("is the issue-log comments in time order, theirs marked 'You'", () => {
    const out = reporterConversation([
      { id: 98, userId: 2, userName: "Graeme Carter", comment: "Can you tell me which suppliers?", createdAt: new Date("2026-10-20T07:12:15Z") },
      { id: 101, userId: 3, userName: "Jane Miles", comment: "Puffin and Macfarlane", createdAt: "2026-10-21T08:00:00Z" },
      { id: 102, userId: 2, userName: "Graeme Carter", comment: "Thanks — any others?", createdAt: "2026-10-21T08:30:00Z" },
      { id: 99, userId: null, userName: null, comment: "Your report changed this", createdAt: "2026-10-20T16:00:00Z" },
    ], 3);
    expect(out.map(e => [e.who, e.name, e.text])).toEqual([
      ["them", "Graeme Carter", "Can you tell me which suppliers?"],
      ["them", "The Calzone Kitchen", "Your report changed this"],
      ["me", "You", "Puffin and Macfarlane"],
      ["them", "Graeme Carter", "Thanks — any others?"],
    ]);
  });
});
