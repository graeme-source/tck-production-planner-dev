#!/usr/bin/env tsx
/**
 * reopen-fix-card.ts — put a Fix queue card that closed by mistake back in
 * To review (Graeme, 2026-10-13; Objectives E, F).
 *
 * Written for issue #323: Graeme asked Jane a question from the card, and the
 * old message box ("This answers it — close the report", ticked by default)
 * marked it answered, resolved the report and credited an improvement, so
 * the card left To review. Messaging no longer closes anything by itself;
 * this repairs the one card that already closed.
 *
 * What it does, in one transaction:
 *  - issue_triage.status → 'proposed' (fixed_at / issue_resolved_at cleared;
 *    the old decision stays in the event history), snooze cleared;
 *  - andon_issues.resolved_* cleared, so the report is open on the issue log;
 *  - an event 'reopened' with a note, shown on the card's Conversation.
 * It does NOT touch the credited improvement (see the report it prints),
 * does NOT message anyone and does NOT hand the card to Claude.
 * Refuses: cards dismissed with no action (use Restore), cards Claude is
 * working on or has fixed (use Reply to Claude), cards already open.
 *
 * Dry run (default — prints what would change, writes nothing):
 *   cd artifacts/api-server
 *   node --env-file=.env --import tsx/esm scripts/reopen-fix-card.ts --issue 323
 *
 * Apply:
 *   node --env-file=.env --import tsx/esm scripts/reopen-fix-card.ts --issue 323 --apply
 *
 * Optional: --note "why" (default: "messaging the reporter closed it by mistake").
 * Point DATABASE_URL at the database to change (live: Graeme runs it).
 */
import { pool, db, issueTriageTable, andonIssuesTable, improvementSubmissionsTable, type IssueTriage } from "@workspace/db";
import { eq } from "drizzle-orm";
import { reopenCardPlan, type TriageStatus } from "../src/lib/issue-pipeline-rules";
import { recordEvent } from "../src/lib/issue-pipeline-data";

const t = issueTriageTable;
const triageCols = {
  id: t.id, andonIssueId: t.andonIssueId, lane: t.lane, verdictSummary: t.verdictSummary, status: t.status,
  awaitingRetriage: t.awaitingRetriage, snoozedUntil: t.snoozedUntil, noActionAt: t.noActionAt,
  improvementId: t.improvementId, decidedBy: t.decidedBy, decidedAt: t.decidedAt, decisionNote: t.decisionNote,
  fixRef: t.fixRef, fixedAt: t.fixedAt, issueResolvedAt: t.issueResolvedAt, triagedAt: t.triagedAt, updatedAt: t.updatedAt,
};

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : null;
}

async function main() {
  const issueId = Number(arg("--issue"));
  if (!Number.isInteger(issueId) || issueId <= 0) throw new Error("Usage: --issue <andon issue number> [--apply] [--note \"why\"]");
  const apply = process.argv.includes("--apply");
  const why = arg("--note") ?? "messaging the reporter closed it by mistake";

  // Only columns that exist before AND after migration 0191, so the script
  // runs whether or not that deploy has happened yet.
  const [triage] = await db.select(triageCols).from(issueTriageTable).where(eq(issueTriageTable.andonIssueId, issueId));
  if (!triage) throw new Error(`Issue #${issueId} has no Fix queue card`);
  const [issue] = await db.select().from(andonIssuesTable).where(eq(andonIssuesTable.id, issueId));
  if (!issue) throw new Error(`Issue #${issueId} not found`);

  const plan = reopenCardPlan({ status: triage.status as TriageStatus, noActionAt: triage.noActionAt }, { resolvedAt: issue.resolvedAt }, why);
  console.log(`Issue #${issueId} — ${issue.reportedByName ?? "unknown reporter"}: "${(issue.description ?? "").slice(0, 100)}"`);
  console.log(`  Card ${triage.id}: status '${triage.status}'${triage.snoozedUntil ? `, snoozed until ${triage.snoozedUntil.toISOString()}` : ""}`);
  console.log(`  Report: ${issue.resolvedAt ? `resolved ${issue.resolvedAt.toISOString()} by ${issue.resolvedByName ?? "?"}` : "open"}`);
  if (!plan.ok) {
    console.log(`  Nothing done: ${plan.reason}`);
    return;
  }
  console.log(`  Will: ${[plan.setProposed ? `status '${triage.status}' → 'proposed' (To review)` : null, plan.clearIssueResolved ? "reopen the report on the issue log" : null].filter(Boolean).join("; ")}`);
  console.log(`  History note: "${plan.note}"`);

  if (triage.improvementId != null) {
    const [imp] = await db.select({ id: improvementSubmissionsTable.id, status: improvementSubmissionsTable.progressStatus, credited: improvementSubmissionsTable.creditedToName, doneAt: improvementSubmissionsTable.doneAt })
      .from(improvementSubmissionsTable).where(eq(improvementSubmissionsTable.id, triage.improvementId));
    console.log(`  NOT touched: improvement #${triage.improvementId} (${imp?.status ?? "missing"}, credited to ${imp?.credited ?? "?"}${imp?.doneAt ? `, done ${imp.doneAt.toISOString()}` : ""}).`);
  }

  if (!apply) {
    console.log("\nDry run — nothing written. Add --apply to make the change.");
    return;
  }

  await db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx.update(issueTriageTable).set({
      ...(plan.setProposed ? { status: "proposed", fixedAt: null, issueResolvedAt: null } : {}),
      snoozedUntil: null, awaitingRetriage: false, updatedAt: now,
    }).where(eq(issueTriageTable.id, triage.id)).returning(triageCols);
    if (plan.clearIssueResolved) {
      await tx.update(andonIssuesTable)
        .set({ resolvedBy: null, resolvedByName: null, resolvedAt: null })
        .where(eq(andonIssuesTable.id, issueId));
    }
    // The snapshot is the row as it now stands (the columns read here).
    await recordEvent(tx, row as unknown as IssueTriage, "reopened", "reopen-fix-card script", plan.note);
  });
  console.log("\nApplied. The card is back in To review.");
}

main()
  .catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => pool.end());
