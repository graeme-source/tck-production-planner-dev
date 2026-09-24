/**
 * Client-side helpers for the issue pipeline (docs/ISSUE_PIPELINE.md): the
 * shapes the Fix queue and the reporter's "fixed — please test" pop-up read,
 * plus the small pure bits they share (unit-tested alongside).
 */

export type TriageLane = "defect" | "data_fix" | "understanding" | "improvement" | "needs_info" | "not_app";
export type TriageStatus = "proposed" | "approved" | "rejected" | "in_progress" | "fixed" | "wont_fix" | "answered" | "dismissed";
export type FixQueueTab = "proposed" | "in_progress" | "snoozed" | "approved" | "fixed" | "rejected";

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

export interface FixQueueItem {
  triage: Triage;
  issue: IssueView | null;
  notices: FixNoticeSummary[];
  related: Array<{ id: number; description: string | null; station: string | null; reporterName: string | null; createdAt: string | null; resolvedAt: string | null; triageStatus: TriageStatus | null }>;
}

export interface FixQueueResponse {
  tab: FixQueueTab;
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
  if (tab === "snoozed") return 0;
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
