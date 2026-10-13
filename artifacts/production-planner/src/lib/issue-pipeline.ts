/**
 * Client-side helpers for the issue pipeline (docs/ISSUE_PIPELINE.md): the
 * shapes the Fix queue and the reporter's "fixed — please test" pop-up read,
 * plus the small pure bits they share (unit-tested alongside).
 */

export type TriageLane = "defect" | "data_fix" | "understanding" | "improvement" | "needs_info" | "not_app";
export type TriageStatus = "proposed" | "approved" | "rejected" | "in_progress" | "fixed" | "wont_fix" | "answered" | "dismissed";
export type FixQueueTab = "proposed" | "in_progress" | "snoozed" | "approved" | "fixed" | "rejected" | "no_action";

export interface Triage {
  id: number;
  andonIssueId: number;
  lane: TriageLane;
  verdictSummary: string;
  explanation: string;
  proposedFix: string;
  objective: string | null;
  blastRadius: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  noGoZone: boolean;
  behaviourChange: boolean;
  questionForGraeme: string | null;
  /** Claude's draft message to the reporter — pre-fills "Message the reporter". */
  suggestedReply: string | null;
  /** Claude verified nothing needs doing (already fixed/built, withdrawn,
   *  not a problem) — the card offers Dismiss instead of Approve. */
  noActionNeeded: boolean;
  /** "Not now" — off To review until then (null = not snoozed). */
  snoozedUntil: string | null;
  /** "Dismiss — no action": out of the queue silently (null = not). */
  noActionAt?: string | null;
  noActionBy?: string | null;
  /** The day the fix/feature went live. */
  completedOn: string | null;
  /** The improvement credited to the reporter when this closed. */
  improvementId: number | null;
  relatedIssueIds: number[];
  causeTag: string | null;
  status: TriageStatus;
  awaitingRetriage: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  fixRef: string | null;
  fixedAt: string | null;
  issueResolvedAt: string | null;
  triagedAt: string;
  triagedBy: string;
  /** Graeme messaged the reporter and is waiting for their answer. */
  awaitingReporterSince?: string | null;
  /** The reporter answered and Graeme hasn't looked yet — "New reply". */
  reporterReplyAt?: string | null;
}

export interface IssueView {
  id: number;
  createdAt: string;
  area: string | null;
  category: string;
  severity: "yellow" | "red" | "green";
  station: string;
  description: string | null;
  reportContext: string | null;
  reporter: { id: number | null; name: string | null };
  resolved: { at: string; byName: string | null } | null;
  comments: Array<{ id: number; author: string | null; text: string; createdAt: string }>;
  attachments: Array<{ id: number; kind: string; mime: string; fileName: string | null; createdAt: string; url: string }>;
}

export interface FixNoticeSummary {
  id: number;
  andonIssueId: number;
  userId: number;
  kind: "fixed" | "message";
  ackAction: "test_now" | "later" | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

export interface ThreadEntry {
  at: string;
  who: "claude" | "you" | "reporter";
  kind: "question" | "recommendation" | "reply" | "message" | "decision";
  text: string;
}

export interface FixQueueItem {
  triage: Triage;
  /** Which tab the card is in now (shown on search results). */
  tab?: FixQueueTab;
  issue: IssueView | null;
  notices: FixNoticeSummary[];
  /** The back-and-forth on this card, oldest first. */
  thread?: ThreadEntry[];
  related: Array<{ id: number; description: string | null; station: string | null; reporterName: string | null; createdAt: string | null; resolvedAt: string | null; triageStatus: TriageStatus | null }>;
}

export interface FixQueueResponse {
  tab: FixQueueTab;
  /** Set when this is a search across every tab. */
  q?: string | null;
  counts: Record<TriageStatus, number> & { awaitingReply: number };
  /** Cards per tab, bucketed server-side by the same rule as the lists. */
  tabCounts?: Partial<Record<FixQueueTab, number>>;
  items: FixQueueItem[];
}

export interface MyFixedNotice {
  id: number;
  andonIssueId: number;
  /** 'fixed' = "your report has been fixed"; 'message' = a reply from Graeme. */
  kind: "fixed" | "message";
  quote: string;
  whatChanged: string;
  testPath: string | null;
  createdAt: string;
  reportedAt: string;
  station: string;
}

export const LANE_LABELS: Record<TriageLane, string> = {
  defect: "Defect",
  data_fix: "Data fix",
  understanding: "Understanding",
  improvement: "Improvement",
  needs_info: "Needs more info",
  not_app: "Not an app issue",
};

/** Count shown on each Fix queue tab. Rejected also holds won't-fix. */
export function tabCount(data: Pick<FixQueueResponse, "counts" | "tabCounts"> | undefined, tab: FixQueueTab): number {
  if (!data) return 0;
  // The server buckets every card by one rule (waiting-on-Claude → In
  // progress, snoozed → Snoozed); use its numbers when present.
  const fromServer = data.tabCounts?.[tab];
  if (fromServer != null) return fromServer;
  const counts = data.counts;
  if (tab === "rejected") return (counts.rejected ?? 0) + (counts.wont_fix ?? 0);
  if (tab === "fixed") return (counts.fixed ?? 0) + (counts.answered ?? 0) + (counts.dismissed ?? 0);
  if (tab === "proposed") return Math.max(0, (counts.proposed ?? 0) - (counts.awaitingReply ?? 0));
  if (tab === "snoozed" || tab === "no_action") return 0;
  return counts[tab] ?? 0;
}

/**
 * The server only ever stores in-app paths, but the pop-up navigates on
 * whatever it is given — so it checks again: a single leading "/", no
 * protocol-relative "//", no backslashes or whitespace. Anything else means
 * no "Test it now" button, never an off-site jump.
 */
export function safeTestPath(p: string | null | undefined): string | null {
  if (!p) return null;
  const t = p.trim();
  if (!t.startsWith("/") || t.startsWith("//")) return null;
  if (/[\s\\]/.test(t)) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(t)) return null;
  return t;
}

/** "Reporter notified — tested it now" etc., for the Fix queue card. */
export function noticeStatusLine(n: Pick<FixNoticeSummary, "ackAction" | "acknowledgedAt"> & { kind?: FixNoticeSummary["kind"] }): string {
  if (n.kind === "message") return n.acknowledgedAt ? "Your message — reporter has read it" : "Your message — not seen yet";
  if (!n.acknowledgedAt) return "Reporter notified — not seen yet";
  return n.ackAction === "test_now" ? "Reporter notified — testing it now" : "Reporter notified — will test later";
}

/**
 * Batched reporter pop-up (Graeme, 2026-09-24): when several updates are
 * waiting, one pop-up lists them all instead of a string of separate ones.
 * Wording depends on what's in the batch — fixes to test, replies to read.
 */
export function batchedNoticeCopy(notices: Array<Pick<MyFixedNotice, "kind">>): { heading: string; button: string } {
  const fixes = notices.filter(n => n.kind !== "message").length;
  const replies = notices.length - fixes;
  const heading = fixes > 0 && replies === 0
    ? `${fixes} of your reports ${fixes === 1 ? "has" : "have"} been fixed`
    : replies > 0 && fixes === 0
      ? `${replies} ${replies === 1 ? "reply" : "replies"} to your reports`
      : `Updates on ${notices.length} of your reports`;
  const button = fixes > 0 ? (fixes === 1 ? "Got it — I'll test it" : "Got it — I'll test them") : "Got it";
  return { heading, button };
}

/**
 * The card as it stands the moment Graeme sends "Reply to Claude" — mirrors
 * the server (replyToClaudePlan): back to 'proposed', flagged for Claude,
 * un-snoozed and un-dismissed, with his words added to the conversation.
 * Used to show "Sent — Claude will look at this on its next pass" straight
 * away instead of the card vanishing to another tab.
 */
export function withReplySent(item: FixQueueItem, note: string, now: Date = new Date()): FixQueueItem {
  const at = now.toISOString();
  return {
    ...item,
    triage: {
      ...item.triage,
      status: "proposed",
      awaitingRetriage: true,
      snoozedUntil: null,
      noActionAt: null,
      noActionBy: null,
      decisionNote: note,
      decidedAt: at,
    },
    thread: [...(item.thread ?? []), { at, who: "you", kind: "reply", text: note }],
  };
}

// ── Talking with the reporter (Graeme, 2026-10-13) ──────────────────────────

/** Tab names as the Fix queue shows them — also on search results, so a card
 *  that moved (#323 went to Done) says where it is now. */
export const QUEUE_TAB_LABELS: Record<FixQueueTab, string> = {
  proposed: "To review",
  in_progress: "In progress",
  snoozed: "Snoozed",
  approved: "Approved",
  fixed: "Done",
  rejected: "Rejected",
  no_action: "Dismissed",
};

const LONDON_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
const LONDON_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const LONDON_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });

/** "12:09" today, "Mon 12 Oct, 12:09" any other day (London clock). */
export function clockLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return LONDON_DAY.format(d) === LONDON_DAY.format(now) ? LONDON_TIME.format(d) : `${LONDON_DATE.format(d)}, ${LONDON_TIME.format(d)}`;
}

/** "Waiting for Jane's reply · asked 12:09", or null when not waiting. */
export function waitingForReporterLabel(t: Pick<Triage, "awaitingReporterSince">, firstName: string, now: Date = new Date()): string | null {
  if (!t.awaitingReporterSince) return null;
  return `Waiting for ${firstName}'s reply · asked ${clockLabel(t.awaitingReporterSince, now)}`;
}

/** What the reporter has said since Graeme last wrote to them — the "New
 *  reply" box shows these (oldest first). */
export function newReporterWords(thread: ThreadEntry[]): ThreadEntry[] {
  let lastMine = -1;
  thread.forEach((e, i) => { if (e.who === "you" && e.kind === "message") lastMine = i; });
  return thread.slice(lastMine + 1).filter(e => e.who === "reporter");
}

/**
 * The card the moment Graeme sends a message — mirrors the server
 * (messagePlan): "Message <name>" keeps the status and starts waiting for
 * them; "Send and close" marks it answered. Either way any "New reply" is
 * now seen and his words join the conversation.
 */
export function withMessageSent(item: FixQueueItem, message: string, close: boolean, now: Date = new Date()): FixQueueItem {
  const at = now.toISOString();
  return {
    ...item,
    triage: {
      ...item.triage,
      reporterReplyAt: null,
      awaitingReporterSince: close ? null : at,
      ...(close ? { status: "answered" as const, decisionNote: message, decidedAt: at, issueResolvedAt: at } : {}),
    },
    thread: [...(item.thread ?? []), { at, who: "you", kind: "message", text: message }],
  };
}

/**
 * Which actions a Fix queue card offers, and where (Graeme, 2026-09-24).
 * Each action sits inside the thing it affects — Reply on Claude's question,
 * Approve/Dismiss on the proposed fix, Message on the suggested reply — and
 * Approve is NOT offered while Claude is still asking something or working
 * on his reply: there's a conversation to finish before there's a plan.
 */
export function cardActions(t: Pick<Triage, "status" | "questionForGraeme" | "awaitingRetriage" | "noActionNeeded">) {
  const open = t.status === "proposed" || t.status === "approved" || t.status === "rejected";
  const waitingOnClaude = t.status === "proposed" && t.awaitingRetriage;
  const openQuestion = t.status === "proposed" && !!t.questionForGraeme && !t.awaitingRetriage;
  return {
    /** The in-place "Answer Claude" / "Ask Claude first" prompts. */
    canReply: t.status === "proposed" && !t.awaitingRetriage,
    /** "Reply to Claude" in the bottom row — on EVERY card, whatever its
     *  state (Graeme, 2026-10-12): correct its understanding or give a new
     *  instruction even when it hasn't asked anything. A decided or closed
     *  card is reopened for Claude by the reply. */
    canReplyToClaude: true,
    /** Sending a reply from here reopens a decided/closed card. */
    replyReopens: t.status !== "proposed",
    openQuestion,
    waitingOnClaude,
    canDismiss: open && t.noActionNeeded && !openQuestion && !waitingOnClaude,
    canApprove: (t.status === "proposed" || t.status === "rejected") && !t.noActionNeeded && !openQuestion && !waitingOnClaude,
    /** Approve is held back because a conversation isn't finished. */
    approveBlocked: t.status === "proposed" && !t.noActionNeeded && (openQuestion || waitingOnClaude),
    canReject: t.status === "proposed" || t.status === "approved",
  };
}
