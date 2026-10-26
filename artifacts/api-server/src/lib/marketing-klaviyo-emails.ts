/**
 * Klaviyo emails on the marketing calendar, each with its ONE approval
 * status (Graeme, 2026-10-20). Objective I. READ-ONLY towards Klaviyo:
 * approving only records it in marketing_email_approvals here.
 *
 * Rules (status, "changed since approval", what waits) are pure in
 * @workspace/marketing-calendar email-approvals.ts.
 */
import { db, marketingEmailApprovalsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { awaitsApproval, emailApprovalStatus, klaviyoApprovalKey, type ApprovalSnapshot } from "@workspace/marketing-calendar";
import { klaviyoCampaignResults, klaviyoEmailsForRange, klaviyoUndatedDrafts, type KlaviyoCalendarEmail, type KlaviyoCampaignResult, type KlaviyoUndatedDraft } from "./klaviyo-campaign-calendar";

type ApprovalRow = typeof marketingEmailApprovalsTable.$inferSelect;
type AnyEmail = KlaviyoCalendarEmail | KlaviyoUndatedDraft;

export function snapshotOf(row: ApprovalRow | undefined): ApprovalSnapshot | null {
  if (!row) return null;
  return {
    approved: row.approved,
    subject: row.subject,
    previewText: row.previewText,
    sendAt: row.sendAt ? row.sendAt.toISOString() : null,
    full: row.snapshotFull,
  };
}

export interface EmailWithApproval {
  id: string;
  name: string;
  status: AnyEmail["status"];
  date: string | null;
  sendAt: string | null;
  subject: string | null;
  previewText: string | null;
  abTest: boolean;
  audiences: string[];
  excludedCount: number;
  klaviyoUrl: string;
  approval: {
    status: "approved" | "needs_approval";
    /** What changed in Klaviyo since it was approved ([] = nothing). */
    changed: string[];
    /** Counts in "waiting for your approval". */
    awaits: boolean;
    approvedBy: string | null;
    approvedAt: string | null;
  };
}

export async function withApprovals(emails: readonly AnyEmail[], today: string): Promise<EmailWithApproval[]> {
  const keys = emails.map(e => klaviyoApprovalKey(e.id));
  const rows = keys.length
    ? await db.select().from(marketingEmailApprovalsTable).where(inArray(marketingEmailApprovalsTable.targetKey, keys))
    : [];
  const byKey = new Map(rows.map(r => [r.targetKey, r]));
  return emails.map(e => {
    const row = byKey.get(klaviyoApprovalKey(e.id));
    const { status, changed } = emailApprovalStatus(snapshotOf(row), e);
    return {
      id: e.id, name: e.name, status: e.status, date: e.date, sendAt: e.sendAt,
      subject: e.subject, previewText: e.previewText, abTest: e.abTest, audiences: e.audiences,
      excludedCount: e.excludedCount, klaviyoUrl: e.klaviyoUrl,
      approval: {
        status, changed,
        awaits: awaitsApproval(e, status, today),
        approvedBy: row?.approved ? row.approvedByName : null,
        approvedAt: row?.approved ? row.approvedAt?.toISOString() ?? null : null,
      },
    };
  });
}

/** The calendar's emails in [from, to] plus undated drafts, each with its status. */
export async function calendarEmails(from: string, to: string, today: string): Promise<{
  connected: boolean; emails: Array<EmailWithApproval & { results: KlaviyoCampaignResult | null }>; undatedDrafts: EmailWithApproval[];
  resultsUpdatedAt: string | null;
}> {
  const [ranged, undated] = await Promise.all([klaviyoEmailsForRange(from, to), klaviyoUndatedDrafts()]);
  if (!ranged.connected) return { connected: false, emails: [], undatedDrafts: [], resultsUpdatedAt: null };
  const [emails, drafts] = await Promise.all([withApprovals(ranged.emails, today), withApprovals(undated ?? [], today)]);
  // Sent emails carry Klaviyo's results — opens, clicks, placed orders and
  // their £ (Graeme, 2026-10-26: "see from the sales and marketing
  // dashboard, at a glance, what the data for each campaign is"). One shared
  // report, cached 30 minutes; the calendar still loads if it fails.
  const anySent = emails.some(e => e.status === "Sent" || e.status === "Sending");
  const report = anySent ? await klaviyoCampaignResults().catch(() => null) : null;
  const byId = new Map((report?.results ?? []).map(r => [r.campaignId, r]));
  return {
    connected: true,
    emails: emails.map(e => ({ ...e, results: byId.get(e.id) ?? null })),
    undatedDrafts: drafts,
    resultsUpdatedAt: report?.updatedAt ?? null,
  };
}
