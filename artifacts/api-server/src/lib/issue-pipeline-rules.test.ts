import { describe, it, expect } from "vitest";
import {
  parseBearer,
  checkMachineToken,
  classifyIssueArea,
  matchesAreaFilter,
  retriageVerdict,
  canReviewMove,
  canReply,
  canMessageReporter,
  buildThread,
  queueTabFor,
  canSnooze,
  isImprovementDue,
  improvementDoneAt,
  canDismiss,
  pipelineMayHandle,
  machineMoveVerdict,
  resolveIssueVerdict,
  validateTestPath,
  noticeQuote,
  noticeAckVerdict,
} from "./issue-pipeline-rules";

describe("parseBearer", () => {
  it("extracts the token from a Bearer header, any case", () => {
    expect(parseBearer("Bearer abc123")).toBe("abc123");
    expect(parseBearer("bearer   abc123  ")).toBe("abc123");
  });
  it("returns empty for anything that isn't a Bearer header", () => {
    expect(parseBearer(undefined)).toBe("");
    expect(parseBearer("")).toBe("");
    expect(parseBearer("Basic dXNlcjpwYXNz")).toBe("");
    expect(parseBearer("abc123")).toBe("");
  });
});

describe("checkMachineToken", () => {
  it("is disabled (closed, never open) when no token is configured", () => {
    expect(checkMachineToken("anything", undefined)).toBe("disabled");
    expect(checkMachineToken("anything", "")).toBe("disabled");
    expect(checkMachineToken("", "   ")).toBe("disabled");
  });
  it("accepts only the exact token", () => {
    expect(checkMachineToken("s3cret-token", "s3cret-token")).toBe("ok");
    expect(checkMachineToken("s3cret-toke", "s3cret-token")).toBe("bad");
    expect(checkMachineToken("s3cret-token-longer", "s3cret-token")).toBe("bad");
    expect(checkMachineToken("S3CRET-TOKEN", "s3cret-token")).toBe("bad");
  });
  it("rejects an empty presented token even though one is configured", () => {
    expect(checkMachineToken("", "s3cret-token")).toBe("bad");
  });
});

describe("classifyIssueArea / matchesAreaFilter", () => {
  it("treats area 'system' and the 'App / iPad' station as app issues", () => {
    expect(classifyIssueArea("system", "App / iPad")).toBe("app");
    expect(classifyIssueArea(null, "App / iPad")).toBe("app");
    expect(classifyIssueArea("system", "general")).toBe("app");
  });
  it("keeps factory and pre-0060 reports apart", () => {
    expect(classifyIssueArea("factory", "general")).toBe("factory");
    expect(classifyIssueArea(null, "building_1")).toBe("unspecified");
  });
  it("'all' matches everything; other filters match their class only", () => {
    expect(matchesAreaFilter("all", "factory", "general")).toBe(true);
    expect(matchesAreaFilter("app", "factory", "general")).toBe(false);
    expect(matchesAreaFilter("app", "system", "App / iPad")).toBe(true);
    expect(matchesAreaFilter("unspecified", null, "prep")).toBe(true);
  });
});

describe("retriageVerdict — a new recommendation never silently overwrites a decision", () => {
  it("creates when there is no row, updates a still-proposed row", () => {
    expect(retriageVerdict(null, false)).toEqual({ kind: "create" });
    expect(retriageVerdict("proposed", false)).toEqual({ kind: "update" });
  });
  it("refuses once Graeme has decided or work has started", () => {
    for (const s of ["approved", "rejected", "in_progress", "fixed", "wont_fix"] as const) {
      expect(retriageVerdict(s, false)).toEqual({ kind: "conflict", status: s });
    }
  });
  it("with force, resets to proposed and reports what it replaced", () => {
    expect(retriageVerdict("approved", true)).toEqual({ kind: "forced_reset", previousStatus: "approved" });
    // force on a still-proposed row is just an update
    expect(retriageVerdict("proposed", true)).toEqual({ kind: "update" });
  });
});

describe("review moves (Graeme)", () => {
  it("decides proposed items and can change his mind before work starts", () => {
    expect(canReviewMove("proposed", "approved")).toBe(true);
    expect(canReviewMove("proposed", "rejected")).toBe(true);
    expect(canReviewMove("rejected", "approved")).toBe(true);
    expect(canReviewMove("approved", "rejected")).toBe(true);
  });
  it("can't undo once the session has started or finished", () => {
    expect(canReviewMove("in_progress", "rejected")).toBe(false);
    expect(canReviewMove("fixed", "approved")).toBe(false);
    expect(canReviewMove("proposed", "fixed")).toBe(false);
  });
  it("replies only while an item is waiting on him", () => {
    expect(canReply("proposed")).toBe(true);
    expect(canReply("approved")).toBe(false);
  });
});

describe("canMessageReporter", () => {
  it("a plain message can go at any stage", () => {
    for (const s of ["proposed", "approved", "rejected", "in_progress", "fixed", "wont_fix", "answered"] as const) {
      expect(canMessageReporter(s, false)).toBe(true);
    }
  });
  it("'this answers it' closes reports still open to a decision", () => {
    expect(canMessageReporter("proposed", true)).toBe(true);
    expect(canMessageReporter("approved", true)).toBe(true);
    expect(canMessageReporter("rejected", true)).toBe(true);
  });
  it("never closes one already fixed/answered or with work under way", () => {
    expect(canMessageReporter("fixed", true)).toBe(false);
    expect(canMessageReporter("answered", true)).toBe(false);
    expect(canMessageReporter("in_progress", true)).toBe(false);
  });
});

describe("machineMoveVerdict — the session only works on approved items", () => {
  it("refuses any move on an unapproved recommendation", () => {
    expect(machineMoveVerdict("proposed", "in_progress", {}).ok).toBe(false);
    expect(machineMoveVerdict("rejected", "fixed", { fixRef: "abc" }).ok).toBe(false);
    expect(machineMoveVerdict("wont_fix", "in_progress", {}).ok).toBe(false);
  });
  it("walks approved → in_progress → fixed", () => {
    expect(machineMoveVerdict("approved", "in_progress", {}).ok).toBe(true);
    expect(machineMoveVerdict("in_progress", "fixed", { fixRef: "claude/fix-123" }).ok).toBe(true);
  });
  it("requires a fix_ref for fixed and a note for wont_fix", () => {
    expect(machineMoveVerdict("in_progress", "fixed", {}).ok).toBe(false);
    expect(machineMoveVerdict("in_progress", "fixed", { fixRef: "  " }).ok).toBe(false);
    expect(machineMoveVerdict("approved", "wont_fix", {}).ok).toBe(false);
    expect(machineMoveVerdict("approved", "wont_fix", { note: "Duplicate of #280" }).ok).toBe(true);
  });
  it("lets a failed fix go back to in_progress — but not once the issue is resolved", () => {
    expect(machineMoveVerdict("fixed", "in_progress", {}).ok).toBe(true);
    expect(machineMoveVerdict("fixed", "in_progress", { issueResolved: true }).ok).toBe(false);
    expect(machineMoveVerdict("fixed", "fixed", { fixRef: "abc1234", issueResolved: true }).ok).toBe(true);
  });
});

describe("resolveIssueVerdict", () => {
  it("resolves only a fixed item, once", () => {
    expect(resolveIssueVerdict("fixed", null).ok).toBe(true);
    expect(resolveIssueVerdict("approved", null).ok).toBe(false);
    expect(resolveIssueVerdict("in_progress", null).ok).toBe(false);
    expect(resolveIssueVerdict("fixed", new Date()).ok).toBe(false);
  });
});

describe("validateTestPath — in-app relative paths only", () => {
  it("accepts app paths, with query and hash", () => {
    expect(validateTestPath("/station/wrapping")).toBe("/station/wrapping");
    expect(validateTestPath("  /plans/135/station/ovens?tab=queue#top ")).toBe("/plans/135/station/ovens?tab=queue#top");
    expect(validateTestPath("/")).toBe("/");
  });
  it("treats missing as no path", () => {
    expect(validateTestPath(undefined)).toBeNull();
    expect(validateTestPath(null)).toBeNull();
    expect(validateTestPath("   ")).toBeNull();
  });
  it("rejects external and protocol-relative URLs", () => {
    expect(validateTestPath("https://evil.example")).toBeNull();
    expect(validateTestPath("//evil.example/path")).toBeNull();
    expect(validateTestPath("javascript:alert(1)")).toBeNull();
    expect(validateTestPath("/javascript:alert(1)")).toBeNull();
    expect(validateTestPath("evil.example")).toBeNull();
    expect(validateTestPath("/%2fevil.example")).toBeNull();
    expect(validateTestPath("/\\evil.example")).toBeNull();
  });
  it("rejects whitespace, control chars, API paths and silly lengths", () => {
    expect(validateTestPath("/station/wrap ping")).toBeNull();
    expect(validateTestPath("/station\n/x")).toBeNull();
    expect(validateTestPath("/api/andon")).toBeNull();
    expect(validateTestPath("/API")).toBeNull();
    expect(validateTestPath("/" + "a".repeat(400))).toBeNull();
  });
  it("does not confuse /apiary-like app paths with the API", () => {
    expect(validateTestPath("/apiary")).toBe("/apiary");
  });
});

describe("noticeQuote", () => {
  it("collapses whitespace and keeps short text whole", () => {
    expect(noticeQuote("  Cheese sauce temp\n was 75.4 ", "x")).toBe("Cheese sauce temp was 75.4");
  });
  it("falls back when the reporter left no words", () => {
    expect(noticeQuote(null, "Other issue at App / iPad")).toBe("Other issue at App / iPad");
    expect(noticeQuote("   ", "fallback")).toBe("fallback");
  });
  it("cuts long text at a word boundary with an ellipsis", () => {
    const long = "word ".repeat(100);
    const q = noticeQuote(long, "x", 50);
    expect(q.length).toBeLessThanOrEqual(50);
    expect(q.endsWith("…")).toBe(true);
    expect(q).not.toMatch(/wor…$/);
  });
});

describe("noticeAckVerdict", () => {
  it("lets the reporter acknowledge their own pending notice", () => {
    expect(noticeAckVerdict({ userId: 7, acknowledgedAt: null }, 7)).toEqual({ ok: true });
  });
  it("hides other people's notices as not found", () => {
    expect(noticeAckVerdict({ userId: 7, acknowledgedAt: null }, 8)).toMatchObject({ ok: false, status: 404 });
    expect(noticeAckVerdict(null, 8)).toMatchObject({ ok: false, status: 404 });
  });
  it("acknowledges once", () => {
    expect(noticeAckVerdict({ userId: 7, acknowledgedAt: new Date() }, 7)).toMatchObject({ ok: false, status: 409 });
  });
});

describe("pipelineMayHandle — safety and physical reports stay with people", () => {
  it("refuses safety reports whatever their area", () => {
    expect(pipelineMayHandle({ category: "safety", area: null }).ok).toBe(false);
    expect(pipelineMayHandle({ category: "safety", area: "system" }).ok).toBe(false);
  });
  it("refuses factory-area reports", () => {
    expect(pipelineMayHandle({ category: "equipment", area: "factory" }).ok).toBe(false);
  });
  it("handles app reports and older reports with no area", () => {
    expect(pipelineMayHandle({ category: "other", area: "system" }).ok).toBe(true);
    expect(pipelineMayHandle({ category: "equipment", area: null }).ok).toBe(true);
  });
});

describe("canDismiss — 'already done' closes only reports still awaiting a decision", () => {
  it("dismisses open recommendations", () => {
    for (const s of ["proposed", "approved", "rejected", "wont_fix"] as const) expect(canDismiss(s)).toBe(true);
  });
  it("never re-closes or interrupts work", () => {
    for (const s of ["in_progress", "fixed", "answered", "dismissed"] as const) expect(canDismiss(s)).toBe(false);
  });
});

describe("queueTabFor — To review only shows what needs Graeme now", () => {
  const now = new Date("2026-09-24T10:00:00Z");
  const base = { status: "proposed" as const, awaitingRetriage: false, snoozedUntil: null };
  it("a fresh proposal is To review", () => expect(queueTabFor(base, now)).toBe("proposed"));
  it("waiting on Claude's answer is In progress", () => expect(queueTabFor({ ...base, awaitingRetriage: true }, now)).toBe("in_progress"));
  it("snoozed into the future is Snoozed", () => expect(queueTabFor({ ...base, snoozedUntil: "2026-09-25T10:00:00Z" }, now)).toBe("snoozed"));
  it("a snooze that has run out is back in To review", () => expect(queueTabFor({ ...base, snoozedUntil: "2026-09-24T09:00:00Z" }, now)).toBe("proposed"));
  it("fixed, answered and dismissed are all Done", () => {
    for (const s of ["fixed", "answered", "dismissed"] as const) expect(queueTabFor({ ...base, status: s }, now)).toBe("fixed");
  });
  it("work under way is In progress; won't fix sits with Rejected", () => {
    expect(queueTabFor({ ...base, status: "in_progress" }, now)).toBe("in_progress");
    expect(queueTabFor({ ...base, status: "wont_fix" }, now)).toBe("rejected");
  });
});

describe("canSnooze", () => {
  it("only cards waiting on Graeme", () => {
    expect(canSnooze({ status: "proposed", awaitingRetriage: false })).toBe(true);
    expect(canSnooze({ status: "proposed", awaitingRetriage: true })).toBe(false);
    expect(canSnooze({ status: "approved", awaitingRetriage: false })).toBe(false);
  });
});

describe("isImprovementDue — credit completed improvements once", () => {
  const t = { lane: "improvement", status: "dismissed" as const, issueResolvedAt: null, improvementId: null };
  it("credits a dismissed or answered improvement", () => {
    expect(isImprovementDue(t)).toBe(true);
    expect(isImprovementDue({ ...t, status: "answered" })).toBe(true);
  });
  it("credits a fix only once its report is closed", () => {
    expect(isImprovementDue({ ...t, status: "fixed" })).toBe(false);
    expect(isImprovementDue({ ...t, status: "fixed", issueResolvedAt: "2026-09-24T10:00:00Z" })).toBe(true);
  });
  it("never for defects, open items, or twice", () => {
    expect(isImprovementDue({ ...t, lane: "defect" })).toBe(false);
    expect(isImprovementDue({ ...t, status: "approved" })).toBe(false);
    expect(isImprovementDue({ ...t, improvementId: 12 })).toBe(false);
  });
});

describe("improvementDoneAt", () => {
  const now = new Date("2026-09-24T10:00:00Z");
  it("uses the day it went live", () => expect(improvementDoneAt("2026-06-12", now).toISOString().slice(0, 10)).toBe("2026-06-12"));
  it("falls back to now when unknown, malformed or in the future", () => {
    expect(improvementDoneAt(null, now)).toEqual(now);
    expect(improvementDoneAt("12 June", now)).toEqual(now);
    expect(improvementDoneAt("2026-12-01", now)).toEqual(now);
  });
});

describe("buildThread — the back-and-forth on a card", () => {
  const ev = (event: string, note: string | null, snapshot: unknown = {}, t = "2026-09-24T10:00:00Z") => ({ event, note, createdAt: t, snapshot });
  it("tells the story in order: Claude asks, you reply, Claude answers, you decide", () => {
    const thread = buildThread([
      ev("triaged", null, { verdictSummary: "Jane is right", questionForGraeme: "Fixed allowance or tapped times?" }),
      ev("replied", "Standardise it"),
      ev("retriaged", null, { verdictSummary: "Decided: a standard allowance", questionForGraeme: null }),
      ev("approved", null),
    ]);
    expect(thread.map(t => [t.who, t.kind, t.text])).toEqual([
      ["claude", "question", "Fixed allowance or tapped times?"],
      ["you", "reply", "Standardise it"],
      ["claude", "recommendation", "Decided: a standard allowance"],
      ["you", "decision", "Approved"],
    ]);
  });
  it("doesn't double up a decision note that already says it", () => {
    expect(buildThread([ev("snoozed", "Snoozed for 3 days")])[0].text).toBe("Snoozed for 3 days");
    expect(buildThread([ev("rejected", "Training point")])[0].text).toBe("Rejected — Training point");
  });
  it("drops a repeated identical Claude line", () => {
    expect(buildThread([ev("triaged", null, { verdictSummary: "Same" }), ev("retriaged", null, { verdictSummary: "Same" })])).toHaveLength(1);
  });
  it("shows messages to the reporter and ignores internal bookkeeping", () => {
    const thread = buildThread([ev("messaged", "Hi Jane"), ev("improvement_credited", "credited"), ev("status:fixed", null)]);
    expect(thread).toEqual([{ at: "2026-09-24T10:00:00Z", who: "you", kind: "message", text: "Hi Jane" }]);
  });
});
