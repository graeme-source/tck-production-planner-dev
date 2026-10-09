/**
 * Link a planned email to (or unlink it from) a Klaviyo campaign — ONE place
 * for it, used by the manual PUT /marketing-calendar/emails/:id/klaviyo and
 * by the automatic linker (klaviyo-auto-link-run.ts). Objective H.
 *
 * Inside the caller's transaction: locks the plan, refuses a campaign
 * already linked to another live plan, writes the history line, and carries
 * the plan's approval over to the Klaviyo email. Nothing is written to
 * Klaviyo — a plan only stores the campaign's id and name.
 */
import { db, marketingEmailsTable, marketingEmailHistoryTable } from "@workspace/db";
import { and, eq, isNull, ne } from "drizzle-orm";
import { describeKlaviyoLink } from "@workspace/marketing-calendar";
import { carryApprovalOnLink } from "../routes/marketing-approvals";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type EmailRow = typeof marketingEmailsTable.$inferSelect;

export interface LinkActor { id: number | null; name: string }

/** Stored in the history row's `changes.auto` when the linker made the link. */
export interface AutoLinkNote { summary: string; matched: string; score: number }

export type LinkResult =
  | { status: 200; row: EmailRow }
  | { status: 404 }
  | { status: 409; error: string };

export async function setPlannedEmailKlaviyoLink(tx: Tx, input: {
  emailId: number;
  klaviyoCampaignId: string | null;
  klaviyoCampaignName?: string | null;
  user: LinkActor;
  /** Set by the automatic linker: only links a plan that is still unlinked. */
  auto?: AutoLinkNote;
}): Promise<LinkResult> {
  const { emailId: id, klaviyoCampaignId, user, auto } = input;
  const [before] = await tx.select().from(marketingEmailsTable).where(eq(marketingEmailsTable.id, id)).for("update");
  if (!before || before.deletedAt) return { status: 404 };
  if (before.klaviyoCampaignId === klaviyoCampaignId) return { status: 200, row: before };
  if (auto && before.klaviyoCampaignId) return { status: 409, error: "Already linked by someone" };
  if (klaviyoCampaignId) {
    const [taken] = await tx.select({ id: marketingEmailsTable.id, subject: marketingEmailsTable.subject }).from(marketingEmailsTable)
      .where(and(eq(marketingEmailsTable.klaviyoCampaignId, klaviyoCampaignId), isNull(marketingEmailsTable.deletedAt), ne(marketingEmailsTable.id, id)));
    if (taken) return { status: 409, error: `That Klaviyo email is already linked to the planned email “${taken.subject}”.` };
  }
  const nextName = klaviyoCampaignId ? (input.klaviyoCampaignName || klaviyoCampaignId) : null;
  const [after] = await tx.update(marketingEmailsTable).set({
    klaviyoCampaignId, klaviyoCampaignName: nextName,
    updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
  }).where(eq(marketingEmailsTable.id, id)).returning();
  const change = auto
    ? { action: "linked" as const, summary: auto.summary }
    : describeKlaviyoLink(before.klaviyoCampaignName ?? before.klaviyoCampaignId, nextName)
      ?? { action: "linked" as const, summary: `linked it to the Klaviyo email “${nextName ?? ""}”` };
  await tx.insert(marketingEmailHistoryTable).values({
    emailId: id, userId: user.id, userName: user.name, action: change.action, summary: change.summary,
    changes: {
      klaviyoCampaignId: { from: before.klaviyoCampaignId, to: klaviyoCampaignId },
      ...(auto ? { auto: { matched: auto.matched, score: auto.score } } : {}),
    },
  });
  // The plan and its Klaviyo campaign share one approval from now on.
  if (klaviyoCampaignId && await carryApprovalOnLink(tx, id, klaviyoCampaignId, user)) {
    await tx.insert(marketingEmailHistoryTable).values({
      emailId: id, userId: user.id, userName: user.name, action: "linked",
      summary: "carried its approval over to the Klaviyo email",
    });
  }
  return { status: 200, row: after };
}
