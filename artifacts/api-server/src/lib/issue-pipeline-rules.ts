/**
 * The issue pipeline's rules (docs/ISSUE_PIPELINE.md) — the pure half, kept
 * apart from the routes so every decision here is unit-tested without a
 * database (charter: tests are pure logic).
 *
 *  - Machine token check: constant-time, and an unset token means CLOSED.
 *  - Which andon issues count as "app" issues.
 *  - Re-triage vs Graeme's decision: a new recommendation may never silently
 *    overwrite an approve/reject.
 *  - Status moves: who may move a recommendation where. The scheduled
 *    session can only work on what Graeme approved.
 *  - The reporter's "fixed — please test" notice: in-app test paths only,
 *    and only the reporter can acknowledge their own notice.
 */
import { createHash, timingSafeEqual } from "node:crypto";

// ── Vocabulary ──────────────────────────────────────────────────────────────

/** ISSUE_PIPELINE.md §1's four lanes, plus "needs more info" and "not an
 *  app issue" for reports the session can't (or shouldn't) place. */
export const TRIAGE_LANES = ["defect", "data_fix", "understanding", "improvement", "needs_info", "not_app"] as const;
export type TriageLane = (typeof TRIAGE_LANES)[number];

export const TRIAGE_STATUSES = ["proposed", "approved", "rejected", "in_progress", "fixed", "wont_fix", "answered", "dismissed"] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

export const LEVELS = ["low", "medium", "high"] as const;

export const NOTICE_ACK_ACTIONS = ["test_now", "later"] as const;
export type NoticeAckAction = (typeof NOTICE_ACK_ACTIONS)[number];

// ── Machine token ───────────────────────────────────────────────────────────

/** "Bearer abc" → "abc". Anything else → "". */
export function parseBearer(header: string | undefined | null): string {
  if (!header) return "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]!.trim() : "";
}

export type TokenVerdict = "disabled" | "ok" | "bad";

/**
 * Compare the presented token to the configured one in constant time.
 * Both sides are hashed first so the comparison is always over equal-length
 * buffers — timingSafeEqual throws on a length mismatch, and an early
 * length check would itself leak the token's length.
 *
 * No configured token (unset or blank) = "disabled": the machine API is
 * closed, never open. An empty presented token is always "bad".
 */
export function checkMachineToken(presented: string, expected: string | undefined | null): TokenVerdict {
  const want = (expected ?? "").trim();
  if (!want) return "disabled";
  if (!presented) return "bad";
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(want, "utf8").digest();
  return timingSafeEqual(a, b) ? "ok" : "bad";
}

// ── Which issues are "app" issues ───────────────────────────────────────────

/** How the report form records an app problem (record-issue-modal.tsx):
 *  area 'system' and the station "App / iPad". Reports from before the area
 *  column (migration 0060, live since 2026-08-27) have area NULL, so the
 *  station name is the fallback signal. */
export const APP_AREA_VALUE = "system";
export const APP_STATION_NAME = "App / iPad";

export type IssueAreaClass = "app" | "factory" | "unspecified";
export const AREA_FILTERS = ["app", "factory", "unspecified", "all"] as const;
export type AreaFilter = (typeof AREA_FILTERS)[number];

export function classifyIssueArea(area: string | null | undefined, station: string | null | undefined): IssueAreaClass {
  if (area === APP_AREA_VALUE || station === APP_STATION_NAME) return "app";
  if (area === "factory") return "factory";
  return "unspecified";
}

export function matchesAreaFilter(filter: AreaFilter, area: string | null | undefined, station: string | null | undefined): boolean {
  return filter === "all" || classifyIssueArea(area, station) === filter;
}

/**
 * Does the session's GET /issues list need this report? Untriaged reports
 * follow the area filter. A reply Graeme is waiting on does NOT: once a card
 * is in the Fix queue his reply must reach Claude whatever area the report
 * came from (2026-09-25: #191, logged from the prep station with no area,
 * sat "waiting for Claude" for a day because the hourly run asks for app
 * reports only). Safety and factory reports are still never handed over.
 */
export function machineIssueWanted(
  filter: AreaFilter,
  issue: { area: string | null | undefined; station: string | null | undefined; category: string },
  triage: { awaitingRetriage: boolean } | null | undefined,
  includeTriaged: boolean,
): boolean {
  if (triage?.awaitingRetriage) return pipelineMayHandle(issue).ok;
  if (!matchesAreaFilter(filter, issue.area, issue.station)) return false;
  return includeTriaged || !triage;
}

// ── Re-triage vs decision ───────────────────────────────────────────────────

/** Statuses that carry a human decision (or work that followed one). */
const DECIDED: ReadonlySet<TriageStatus> = new Set(["approved", "rejected", "in_progress", "fixed", "wont_fix"]);

export type RetriageVerdict =
  | { kind: "create" }
  | { kind: "update" }                  // still 'proposed' — nothing decided yet
  | { kind: "conflict"; status: TriageStatus }
  | { kind: "forced_reset"; previousStatus: TriageStatus }; // decision archived, row back to 'proposed'

/**
 * May the session (re)write a recommendation for this issue?
 * A proposal nobody has decided on can be refined freely. Once Graeme has
 * decided (or work has started), a new recommendation is refused — unless
 * `force` is set, in which case the row goes back to 'proposed' for a fresh
 * decision and the old decision is kept in the event history.
 */
export function retriageVerdict(current: TriageStatus | null, force: boolean): RetriageVerdict {
  if (current === null) return { kind: "create" };
  if (!DECIDED.has(current)) return { kind: "update" };
  return force ? { kind: "forced_reset", previousStatus: current } : { kind: "conflict", status: current };
}

// ── Status moves ────────────────────────────────────────────────────────────

/** Graeme's decisions from the Fix queue. He can change his mind until work
 *  starts; after that the session owns the status. */
const REVIEW_MOVES: Record<TriageStatus, readonly TriageStatus[]> = {
  proposed: ["approved", "rejected"],
  rejected: ["approved"],
  approved: ["rejected"],
  in_progress: [],
  fixed: [],
  wont_fix: [],
  answered: [],
  dismissed: [],
};

export function canReviewMove(from: TriageStatus, to: TriageStatus): boolean {
  return REVIEW_MOVES[from].includes(to);
}

/** "Reply / ask" goes back to the session for another look — only while the
 *  recommendation is still waiting on Graeme. */
export function canReply(from: TriageStatus): boolean {
  return from === "proposed";
}

/** "Message the reporter" (Graeme, 2026-09-24). A message on its own can go
 *  at any time. Closing the report with it ("this answers it") is only for
 *  reports not already closed by a fix or an earlier answer, and never once
 *  work is under way — then the fix itself closes it. */
export function canMessageReporter(from: TriageStatus, close: boolean): boolean {
  if (!close) return true;
  return from === "proposed" || from === "approved" || from === "rejected" || from === "wont_fix";
}

/**
 * Reports the pipeline must never touch (Graeme, 2026-09-24). Safety reports
 * and physical factory issues stay on the andon log — and on the morning
 * meeting's safety slides — until someone has actually sorted them out in the
 * room. Claude can't see the room, so it may not triage them or close them,
 * however they're worded. Only people resolve these, in the andon log.
 */
export function pipelineMayHandle(issue: { category: string; area: string | null | undefined }): { ok: true } | { ok: false; error: string } {
  if (issue.category === "safety") {
    return { ok: false, error: "Safety reports stay on the log until they're physically resolved — the pipeline never handles them." };
  }
  if (issue.area === "factory") {
    return { ok: false, error: "Factory (physical) reports are resolved in the room, not by the pipeline." };
  }
  return { ok: true };
}

/** "Dismiss — already done": closes a report nobody needs to act on. Only
 *  for reports still open to a decision — never one already closed or with
 *  work under way. */
export function canDismiss(from: TriageStatus): boolean {
  return from === "proposed" || from === "approved" || from === "rejected" || from === "wont_fix";
}

// ── Fix queue tabs (Graeme, 2026-09-24) ─────────────────────────────────────
// To review is a LIVE list of what needs Graeme right now: a card he has
// replied to is waiting on Claude (In progress) and one he snoozed is out of
// sight (Snoozed) until its time is up — both come back by themselves.
export const QUEUE_TABS = ["proposed", "in_progress", "snoozed", "approved", "fixed", "rejected"] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];

export function queueTabFor(
  t: { status: TriageStatus; awaitingRetriage: boolean; snoozedUntil: Date | string | null },
  now: Date,
): QueueTab {
  switch (t.status) {
    case "proposed":
      if (t.awaitingRetriage) return "in_progress";
      if (t.snoozedUntil && new Date(t.snoozedUntil).getTime() > now.getTime()) return "snoozed";
      return "proposed";
    case "in_progress": return "in_progress";
    case "approved": return "approved";
    case "fixed": case "answered": case "dismissed": return "fixed";
    case "rejected": case "wont_fix": return "rejected";
  }
}

/** "Not now": snooze lengths offered, in days. */
export const SNOOZE_DAYS = [1, 3, 7, 14, 30] as const;

/** Only a card waiting on Graeme can be snoozed. */
export function canSnooze(t: { status: TriageStatus; awaitingRetriage: boolean }): boolean {
  return t.status === "proposed" && !t.awaitingRetriage;
}

// ── Crediting completed improvements (Graeme, 2026-09-24) ──────────────────
// A report that was clearly an improvement to the system (lane
// 'improvement'), once it's done, becomes a completed improvement credited
// to the person who reported it — once only.
export function isImprovementDue(t: {
  lane: string; status: TriageStatus; issueResolvedAt: Date | string | null; improvementId: number | null;
}): boolean {
  if (t.lane !== "improvement" || t.improvementId != null) return false;
  if (t.status === "dismissed" || t.status === "answered") return true;
  return t.status === "fixed" && t.issueResolvedAt != null;
}

/** When the credited improvement counts as done: the day it actually went
 *  live (midday, so it lands on that London day), else now. Keeps old
 *  reports from piling onto today's "improvements completed". */
export function improvementDoneAt(completedOn: string | null | undefined, now: Date): Date {
  if (completedOn && /^\d{4}-\d{2}-\d{2}$/.test(completedOn)) {
    const d = new Date(`${completedOn}T12:00:00`);
    if (!Number.isNaN(d.getTime()) && d.getTime() <= now.getTime()) return d;
  }
  return now;
}

// ── The conversation on a card (Graeme, 2026-09-24) ─────────────────────────
// Each report is a back-and-forth: Claude's recommendation or question, his
// replies, Claude's updated answers, then the decision. Built from the
// append-only issue_triage_events history so nothing new is stored.
export interface ThreadEntry {
  at: string;
  who: "claude" | "you" | "reporter";
  kind: "question" | "recommendation" | "reply" | "message" | "decision";
  text: string;
}

interface EventLike {
  event: string;
  note: string | null;
  createdAt: Date | string;
  snapshot: unknown;
}

const DECISION_WORDS: Record<string, string> = {
  approved: "Approved",
  rejected: "Rejected",
  dismissed: "Dismissed — already done",
  snoozed: "Snoozed",
};

export function buildThread(events: EventLike[]): ThreadEntry[] {
  const out: ThreadEntry[] = [];
  for (const e of events) {
    const at = typeof e.createdAt === "string" ? e.createdAt : e.createdAt.toISOString();
    const snap = (e.snapshot ?? {}) as { verdictSummary?: string; questionForGraeme?: string | null };
    if (e.event === "triaged" || e.event === "retriaged") {
      if (snap.questionForGraeme) out.push({ at, who: "claude", kind: "question", text: snap.questionForGraeme });
      else if (snap.verdictSummary) out.push({ at, who: "claude", kind: "recommendation", text: snap.verdictSummary });
    } else if (e.event === "replied" && e.note) {
      out.push({ at, who: "you", kind: "reply", text: e.note });
    } else if ((e.event === "messaged" || e.event === "answered") && e.note) {
      out.push({ at, who: "you", kind: "message", text: e.note });
    } else if (DECISION_WORDS[e.event]) {
      const word = DECISION_WORDS[e.event];
      // Some notes already say it ("Snoozed for 3 days") — don't double up.
      const first = word.split(" ")[0].toLowerCase();
      const text = !e.note ? word : e.note.toLowerCase().startsWith(first) ? e.note : `${word} — ${e.note}`;
      out.push({ at, who: "you", kind: "decision", text });
    } else if (e.event === "notice_ack" && e.note) {
      out.push({ at, who: "reporter", kind: "decision", text: e.note });
    }
  }
  // Consecutive identical Claude lines (a refine that didn't change the
  // headline) add nothing.
  return out.filter((x, i) => !(i > 0 && x.who === "claude" && out[i - 1].who === "claude" && out[i - 1].text === x.text));
}

export const NOTICE_KINDS = ["fixed", "message"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const MACHINE_TARGETS = ["in_progress", "fixed", "wont_fix"] as const;
export type MachineTarget = (typeof MACHINE_TARGETS)[number];

/** The scheduled session's moves. Nothing unapproved can ever be worked on:
 *  proposed / rejected have no machine moves at all. Re-sending the same
 *  status is allowed (e.g. updating fix_ref on a fixed item), and a fix that
 *  failed its check can go back to in_progress. */
const MACHINE_MOVES: Record<TriageStatus, readonly MachineTarget[]> = {
  proposed: [],
  rejected: [],
  approved: ["in_progress", "fixed", "wont_fix"],
  in_progress: ["in_progress", "fixed", "wont_fix"],
  fixed: ["fixed", "in_progress"],
  wont_fix: [],
  // Closed by Graeme's message or dismissal — nothing left for the session.
  answered: [],
  dismissed: [],
};

export type MachineMoveVerdict = { ok: true } | { ok: false; error: string };

export function machineMoveVerdict(
  from: TriageStatus,
  to: MachineTarget,
  opts: { fixRef?: string | null; note?: string | null; issueResolved?: boolean },
): MachineMoveVerdict {
  if (!MACHINE_MOVES[from].includes(to)) {
    return { ok: false, error: `Can't move a '${from}' recommendation to '${to}'${from === "proposed" || from === "rejected" ? " — it hasn't been approved" : ""}` };
  }
  if (to === "fixed" && !opts.fixRef?.trim()) return { ok: false, error: "fixRef (branch / commit / PR) is required to mark fixed" };
  if (to === "wont_fix" && !opts.note?.trim()) return { ok: false, error: "note is required to mark wont_fix — say why" };
  if (opts.issueResolved && to !== "fixed") return { ok: false, error: "The andon issue has already been resolved for this fix" };
  return { ok: true };
}

/** resolve-issue runs once, after Graeme has deployed a fixed item. */
export function resolveIssueVerdict(status: TriageStatus, issueResolvedAt: Date | string | null): MachineMoveVerdict {
  if (status !== "fixed") return { ok: false, error: `Only a 'fixed' recommendation can resolve its issue (this one is '${status}')` };
  if (issueResolvedAt) return { ok: false, error: "This issue was already resolved by the pipeline" };
  return { ok: true };
}

// ── The reporter's "fixed — please test" notice ─────────────────────────────

/**
 * An in-app path the reporter can be sent to, or null if it isn't one.
 * Must start with a single "/" (so "//evil.com" — a protocol-relative URL —
 * is out), carry no scheme, backslash, whitespace or control characters, and
 * not point at the API. Query strings and hashes are fine.
 */
export function validateTestPath(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const p = raw.trim();
  if (!p || p.length > 300) return null;
  if (!p.startsWith("/") || p.startsWith("//")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\\\u0000-\u001f\u007f]/.test(p)) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(p)) return null;
  const pathOnly = p.split(/[?#]/)[0]!.toLowerCase();
  if (pathOnly === "/api" || pathOnly.startsWith("/api/")) return null;
  // Percent-encoded slashes/backslashes could smuggle "//" past the check.
  if (/^\/%(2f|5c)/i.test(p)) return null;
  return p;
}

/** The reporter's own words, short enough to recognise at a glance. */
export function noticeQuote(description: string | null | undefined, fallback: string, max = 220): string {
  const text = (description ?? "").replace(/\s+/g, " ").trim() || fallback;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export type NoticeAckVerdict = { ok: true } | { ok: false; status: 403 | 404 | 409; error: string };

/** Only the reporter acknowledges their own notice, once. Someone else's
 *  notice reads as "not found" — no hint it exists. */
export function noticeAckVerdict(
  notice: { userId: number; acknowledgedAt: Date | string | null } | null,
  sessionUserId: number,
): NoticeAckVerdict {
  if (!notice || notice.userId !== sessionUserId) return { ok: false, status: 404, error: "Notice not found" };
  if (notice.acknowledgedAt) return { ok: false, status: 409, error: "Already acknowledged" };
  return { ok: true };
}
