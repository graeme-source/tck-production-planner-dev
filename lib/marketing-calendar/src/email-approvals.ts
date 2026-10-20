/**
 * ONE approval per Klaviyo email (Graeme, 2026-10-20) — the pure rules,
 * shared by the server (routes/marketing-approvals.ts) and the page. Tested
 * in email-approvals.test.ts.
 *
 * Emails are only built in Klaviyo. The calendar reads them, and an
 * approver marks each one Approved. Approving records it in this app only —
 * nothing is ever written to Klaviyo. The approval keeps a snapshot of the
 * subject line, preview text and send time; if any of them changes in
 * Klaviyo afterwards, the email goes back to "Needs approval".
 */

export type KlaviyoStatus = "Draft" | "Scheduled" | "Sending" | "Sent";

/** The one approval row for a Klaviyo campaign. */
export function klaviyoApprovalKey(campaignId: string): string {
  return `klaviyo:${campaignId}`;
}

export interface EmailFacts {
  status: KlaviyoStatus | string;
  /** London day it sends; null = a draft with no send date yet. */
  date: string | null;
  sendAt: string | null;
  subject: string | null;
  previewText: string | null;
}

export interface ApprovalSnapshot {
  approved: boolean;
  subject: string | null;
  previewText: string | null;
  sendAt: string | null;
  /** false = an older approval that only kept the subject line. */
  full: boolean;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

/** Same minute (send times arrive as different ISO spellings); both blank = same. */
export function sameSendTime(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.isNaN(ta) && Number.isNaN(tb);
  return Math.floor(ta / 60_000) === Math.floor(tb / 60_000);
}

/** What changed in Klaviyo since it was approved, in words ([] = nothing). */
export function changedSinceApproval(snapshot: ApprovalSnapshot, now: Pick<EmailFacts, "subject" | "previewText" | "sendAt">): string[] {
  const out: string[] = [];
  if (norm(snapshot.subject) !== norm(now.subject)) out.push("subject line");
  if (!snapshot.full) return out;
  if (norm(snapshot.previewText) !== norm(now.previewText)) out.push("preview text");
  if (!sameSendTime(snapshot.sendAt, now.sendAt)) out.push("send time");
  return out;
}

export type ApprovalStatus = "approved" | "needs_approval";

/**
 * THE status. Approved = approved, and the subject / preview / send time are
 * still what was approved. Anything else is "Needs approval" (with what
 * changed, when it was approved before).
 */
export function emailApprovalStatus(snapshot: ApprovalSnapshot | null | undefined, now: EmailFacts): {
  status: ApprovalStatus; changed: string[];
} {
  if (!snapshot || !snapshot.approved) return { status: "needs_approval", changed: [] };
  const changed = changedSinceApproval(snapshot, now);
  return { status: changed.length ? "needs_approval" : "approved", changed };
}

/**
 * Does it count in the "waiting for your approval" number (and the nav
 * badge)? Drafts and scheduled emails that haven't sent and aren't
 * approved: sending today or later, or a draft with no date yet. Sent ones
 * are too late to nag about; a draft parked on a past day is stale.
 */
export function awaitsApproval(email: EmailFacts, status: ApprovalStatus, today: string): boolean {
  if (status === "approved") return false;
  if (email.status !== "Draft" && email.status !== "Scheduled") return false;
  if (email.date == null) return email.status === "Draft";
  return email.date >= today;
}

/** "Approved by Graeme" / "Needs approval" — the badge words, one place. */
export function approvalLabel(status: ApprovalStatus, approvedByName: string | null | undefined, changed: readonly string[] = []): string {
  if (status === "approved") {
    const who = approvedByName?.trim().split(/\s+/)[0];
    return who ? `Approved by ${who}` : "Approved";
  }
  return changed.length ? `Needs approval — ${changed.join(", ")} changed` : "Needs approval";
}
