/**
 * Regression tests for issue #323 (Graeme, 2026-10-13): messaging the
 * reporter must never close the card by itself; the reporter's answer comes
 * back to To review; and a card that moved is always findable.
 */
import { describe, it, expect } from "vitest";
import {
  buildThread,
  canMessageReporter,
  fixQueueMatches,
  isImprovementDue,
  messagePlan,
  queueTabFor,
  reopenCardPlan,
  reporterResponsePlan,
  searchTerms,
  type TriageStatus,
} from "./issue-pipeline-rules";

const now = new Date("2026-10-13T13:00:00Z");
const card = (over: Partial<{ status: TriageStatus; awaitingRetriage: boolean; snoozedUntil: string | null; noActionAt: string | null; reporterReplyAt: string | null }> = {}) => ({
  status: "proposed" as TriageStatus, awaitingRetriage: false, snoozedUntil: null, noActionAt: null, reporterReplyAt: null, ...over,
});

describe("messagePlan — Message <name> vs Send and close", () => {
  it("Message keeps the card where it is: no status change, no resolve, no credit (#323)", () => {
    const p = messagePlan(false);
    expect(p).toEqual({ event: "messaged_reporter", statusTo: null, resolveIssue: false, creditImprovement: false, awaitReporter: true });
    // The card Graeme messaged from To review is still in To review.
    expect(queueTabFor(card(), now)).toBe("proposed");
    // …and an improvement is never credited on a plain message: the status
    // didn't move, so nothing is due.
    expect(isImprovementDue({ lane: "improvement", status: "proposed", issueResolvedAt: null, improvementId: null })).toBe(false);
  });

  it("Send and close is today's behaviour: answered, resolved, credited", () => {
    const p = messagePlan(true);
    expect(p).toEqual({ event: "answered", statusTo: "answered", resolveIssue: true, creditImprovement: true, awaitReporter: false });
    expect(queueTabFor(card({ status: "answered" }), now)).toBe("fixed");
    // …but answering is not a fix, so no improvement credit (Graeme, 27 Oct 2026).
    expect(isImprovementDue({ lane: "improvement", status: "answered", issueResolvedAt: new Date(), improvementId: null })).toBe(false);
  });

  it("a message can go again and again, from any state", () => {
    for (const s of ["proposed", "approved", "rejected", "in_progress", "fixed", "wont_fix", "answered", "dismissed"] as TriageStatus[]) {
      expect(canMessageReporter(s, false)).toBe(true);
    }
    // Closing still only applies to cards not already closed or being fixed.
    expect(canMessageReporter("answered", true)).toBe(false);
    expect(canMessageReporter("in_progress", true)).toBe(false);
  });
});

describe("reporterResponsePlan — the reporter's answer comes back to Graeme", () => {
  const waiting = { andonIssueId: 323, awaitingReporterSince: "2026-10-13T12:09:00Z" };
  const notWaiting = { andonIssueId: 323, awaitingReporterSince: null };

  it("a typed reply always flags the card, whatever kind of notice", () => {
    expect(reporterResponsePlan(notWaiting, { kind: "message", action: "later", reply: "Only XXL — the others are right" }))
      .toEqual({ event: "reporter_replied", note: "Only XXL — the others are right", flagForGraeme: true, answers: true });
    expect(reporterResponsePlan(notWaiting, { kind: "fixed", action: "later", reply: "Still broken" }).flagForGraeme).toBe(true);
    expect(reporterResponsePlan(notWaiting, { kind: "fixed", action: "comment", reply: "a comment on the log" }).event).toBe("reporter_replied");
  });

  // Regression (Graeme, 21 Oct 2026): on 20 Oct Jane tapped "Got it" on
  // three messages at once (#335–#337). #336 and #337 then said "New reply
  // from Jane" with no words in them, so Graeme went looking for replies
  // that had never been written. "Got it" is a read receipt, not a reply.
  it("'Got it' on a question Graeme is waiting on is a read receipt: no 'New reply', still waiting (#336, #337)", () => {
    const p = reporterResponsePlan(waiting, { kind: "message", action: "later", reply: "  " });
    expect(p).toEqual({ event: "notice_ack", note: "Issue #323: read your message", flagForGraeme: false, answers: false });
  });

  it("'Got it' on a Send-and-close message just closes the loop", () => {
    expect(reporterResponsePlan(notWaiting, { kind: "message", action: "later" }).flagForGraeme).toBe(false);
  });

  it("acknowledging a fix is recorded but doesn't pull the card back", () => {
    expect(reporterResponsePlan(waiting, { kind: "fixed", action: "test_now" })).toEqual({ event: "notice_ack", note: "Issue #323: testing it now", flagForGraeme: false, answers: false });
    expect(reporterResponsePlan(notWaiting, { kind: "fixed", action: "later" }).note).toBe("Issue #323: will test later");
  });
});

describe("queueTabFor — a new reply from the reporter puts the card in To review", () => {
  const at = "2026-10-13T14:29:00Z";
  it("from Done, Approved, In progress, Snoozed or waiting-on-Claude", () => {
    expect(queueTabFor(card({ status: "answered", reporterReplyAt: at }), now)).toBe("proposed");
    expect(queueTabFor(card({ status: "approved", reporterReplyAt: at }), now)).toBe("proposed");
    expect(queueTabFor(card({ status: "in_progress", reporterReplyAt: at }), now)).toBe("proposed");
    expect(queueTabFor(card({ snoozedUntil: "2026-10-20T00:00:00Z", reporterReplyAt: at }), now)).toBe("proposed");
    expect(queueTabFor(card({ awaitingRetriage: true, reporterReplyAt: at }), now)).toBe("proposed");
  });
  it("once Graeme has acted (reply cleared) it goes back to where its status puts it", () => {
    expect(queueTabFor(card({ status: "answered" }), now)).toBe("fixed");
  });
  it("Dismissed — no action still wins: the pipeline leaves it alone", () => {
    expect(queueTabFor(card({ noActionAt: at, reporterReplyAt: at }), now)).toBe("no_action");
  });
});

describe("buildThread — the whole conversation shows on the card", () => {
  it("shows Graeme's messages and the reporter's replies in order", () => {
    const thread = buildThread([
      { event: "triaged", note: null, createdAt: "2026-10-13T12:05:00Z", snapshot: { verdictSummary: "Remove the XXL tin label" } },
      { event: "messaged_reporter", note: "Only XXL tins?", createdAt: "2026-10-13T12:09:00Z", snapshot: {} },
      { event: "notice_ack", note: "Issue #323: read your message", createdAt: "2026-10-13T12:30:00Z", snapshot: {} },
      { event: "reporter_replied", note: "Yes, only XXL", createdAt: "2026-10-13T14:29:00Z", snapshot: {} },
      { event: "messaged_reporter", note: "Thanks — why?", createdAt: "2026-10-13T14:40:00Z", snapshot: {} },
      { event: "reporter_reply_seen", note: null, createdAt: "2026-10-13T14:41:00Z", snapshot: {} },
    ]);
    expect(thread.map(e => [e.who, e.kind, e.text])).toEqual([
      ["claude", "recommendation", "Remove the XXL tin label"],
      ["you", "message", "Only XXL tins?"],
      ["reporter", "read", "Read your message"],
      ["reporter", "reply", "Yes, only XXL"],
      ["you", "message", "Thanks — why?"],
    ]);
  });
});

describe("fixQueueMatches — find a card across every tab", () => {
  const jane = { issueId: 323, reporterName: "Jane Miles", description: "Please can we remove the sized tins across all prep items that state XXL", verdictSummary: "Hide the tin-size label on prep cards", station: "App / iPad" };

  it("by issue number, with or without #", () => {
    expect(fixQueueMatches("323", jane)).toBe(true);
    expect(fixQueueMatches("#323", jane)).toBe(true);
    expect(fixQueueMatches("32", jane)).toBe(false);
    expect(fixQueueMatches("#324", jane)).toBe(false);
  });
  it("by reporter name or words, any case, every word must match", () => {
    expect(fixQueueMatches("jane", jane)).toBe(true);
    expect(fixQueueMatches("Miles", jane)).toBe(true);
    expect(fixQueueMatches("xxl tins", jane)).toBe(true);
    expect(fixQueueMatches("jane label", jane)).toBe(true);
    expect(fixQueueMatches("jane oven", jane)).toBe(false);
  });
  it("a number written in the words also matches", () => {
    expect(fixQueueMatches("40", { ...jane, description: "the 40 L kettle" })).toBe(true);
    expect(fixQueueMatches("4", { ...jane, description: "the 40 L kettle" })).toBe(false);
  });
  it("an empty search matches nothing (the tabs show everything)", () => {
    expect(fixQueueMatches("   ", jane)).toBe(false);
    expect(searchTerms("  #323  Jane ")).toEqual(["323", "jane"]);
  });
  it("missing fields don't break it", () => {
    expect(fixQueueMatches("jane", { issueId: 1, reporterName: null, description: null, verdictSummary: null, station: null })).toBe(false);
  });
});

describe("reopenCardPlan — the #323 repair", () => {
  it("an answered card with a resolved report goes back to To review and the report reopens", () => {
    const p = reopenCardPlan({ status: "answered" }, { resolvedAt: "2026-10-13T13:09:25Z" }, "messaging Jane closed it by mistake");
    expect(p).toMatchObject({ ok: true, previousStatus: "answered", setProposed: true, clearIssueResolved: true });
    expect(p.note).toBe("Reopened to To review (was: Answered) — messaging Jane closed it by mistake");
  });
  it("refuses cards it shouldn't touch", () => {
    expect(reopenCardPlan({ status: "proposed" }, { resolvedAt: null }).ok).toBe(false);
    expect(reopenCardPlan({ status: "in_progress" }, { resolvedAt: null }).ok).toBe(false);
    expect(reopenCardPlan({ status: "fixed" }, { resolvedAt: "2026-10-13T13:09:25Z" }).ok).toBe(false);
    expect(reopenCardPlan({ status: "answered", noActionAt: "2026-10-13T13:09:25Z" }, { resolvedAt: null }).ok).toBe(false);
  });
  it("a proposed card whose report was closed just reopens the report", () => {
    expect(reopenCardPlan({ status: "proposed" }, { resolvedAt: "2026-10-13T13:09:25Z" })).toMatchObject({ ok: true, setProposed: false, clearIssueResolved: true });
  });
});
