#!/usr/bin/env tsx
/**
 * merge-marketing-email-duplicates.ts — one email = one row (Graeme,
 * 2026-10-14: "we're putting draft emails into the calendar, and then we're
 * building them in Klaviyo, and then it's bringing another one in"). Objective I.
 * The rules are planEmailMerges in @workspace/marketing-calendar (tested).
 *
 * Finds, among live planned emails:
 *   - two planned emails that are the same email (same day, subject lines
 *     alike, not linked to two different Klaviyo campaigns) → merge them:
 *     the kept one takes any field it was missing, both sets of notes, the
 *     furthest stage, the Klaviyo link and the approval; the duplicate's
 *     history moves across and it is SOFT-deleted (deleted_at) — never
 *     hard-deleted;
 *   - a planned email and the Klaviyo campaign that is the same email (same
 *     day + similar name, or the exact suggested campaign name) → link them,
 *     so the calendar shows one item. Same link function as the "Link"
 *     button: history line + approval carried over to the Klaviyo email.
 * Klaviyo is only READ (the calendar's existing client); nothing is written there.
 *
 * Dry run (default — prints what it would do, writes nothing):
 *   cd artifacts/api-server
 *   node --env-file=.env --import tsx/esm scripts/merge-marketing-email-duplicates.ts
 * Apply:
 *   … scripts/merge-marketing-email-duplicates.ts --apply
 * Options: --since YYYY-MM-DD (default 120 days ago) to limit the planned
 * emails looked at. Idempotent: a second run finds nothing to do.
 */
import { and, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db, pool, marketingEmailsTable, marketingEmailHistoryTable, marketingEmailApprovalsTable, marketingEventsTable,
} from "@workspace/db";
import { PHASE_EVENT_TYPE, addDays, campaignForDate, planEmailMerges, type PlanForMerge } from "@workspace/marketing-calendar";
import { klaviyoCampaignsForMatching } from "../src/lib/klaviyo-campaign-calendar";
import { setPlannedEmailKlaviyoLink } from "../src/lib/marketing-email-klaviyo-link";
import { unlinkedPairsFrom } from "../src/lib/klaviyo-auto-link";

const SCRIPT_USER = { id: null, name: "Tidy-up (duplicates)" };
const TEXT_FIELDS = ["offer", "coreMessage", "smsSuggestion", "cadence", "audienceOther", "websiteChange", "metaChange", "sendTime", "emailType", "campaignName"] as const;

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const since = arg("--since") ?? addDays(today, -120);

  const plans = await db.select().from(marketingEmailsTable)
    .where(and(isNull(marketingEmailsTable.deletedAt), gte(marketingEmailsTable.sendDate, since)));
  const phases = await db.select({ id: marketingEventsTable.id, title: marketingEventsTable.name, startDate: marketingEventsTable.startDate, endDate: marketingEventsTable.endDate })
    .from(marketingEventsTable).where(and(isNull(marketingEventsTable.deletedAt), eq(marketingEventsTable.eventType, PHASE_EVENT_TYPE)));
  const approvals = await db.select({ key: marketingEmailApprovalsTable.targetKey }).from(marketingEmailApprovalsTable);
  const approvalKeys = new Set(approvals.map(a => a.key));
  const linkedRows = await db.select({ id: marketingEmailsTable.klaviyoCampaignId }).from(marketingEmailsTable)
    .where(and(isNull(marketingEmailsTable.deletedAt), isNotNull(marketingEmailsTable.klaviyoCampaignId)));
  const history = plans.length
    ? await db.select({ emailId: marketingEmailHistoryTable.emailId, changes: marketingEmailHistoryTable.changes }).from(marketingEmailHistoryTable)
      .where(and(inArray(marketingEmailHistoryTable.emailId, plans.map(p => p.id)), sql`${marketingEmailHistoryTable.changes} -> 'klaviyoCampaignId' IS NOT NULL`))
    : [];

  const campaigns = await klaviyoCampaignsForMatching(addDays(since, -21));
  if (campaigns == null) console.log("Klaviyo isn't connected — only planned-email duplicates are looked at.");

  const forMerge: PlanForMerge[] = plans.map(p => ({
    id: p.id, sendDate: p.sendDate, subject: p.subject, status: p.status,
    klaviyoCampaignId: p.klaviyoCampaignId, klaviyoCampaignName: p.klaviyoCampaignName,
    campaignTitle: campaignForDate(p.sendDate, phases)?.title ?? null,
    campaignName: p.campaignName, cycleDate: p.cycleDate,
    fields: Object.fromEntries(TEXT_FIELDS.map(k => [k, (p[k] as string | null) ?? null])),
    notes: p.notes,
    hasPlanApproval: approvalKeys.has(`plan:${p.id}`),
  }));
  const plan = planEmailMerges({
    plans: forMerge,
    campaigns: campaigns ?? [],
    linkedCampaignIds: linkedRows.map(r => r.id).filter((x): x is string => !!x),
    rejected: unlinkedPairsFrom(history).map(r => ({ targetKey: `plan:${r.emailId}`, campaignId: r.campaignId })),
  });

  const byId = new Map(plans.map(p => [p.id, p]));
  console.log(`Looked at ${plans.length} planned emails from ${since}, ${campaigns?.length ?? 0} Klaviyo campaigns.`);
  console.log(`\nDuplicates to merge: ${plan.merges.length}`);
  for (const m of plan.merges) {
    const k = byId.get(m.keepId)!, d = byId.get(m.dropId)!;
    console.log(`  ${k.sendDate}  keep #${k.id} “${k.subject}”  ←  #${d.id} “${d.subject}”  (alike ${m.score})`
      + `${Object.keys(m.fill).length ? `; fills ${Object.keys(m.fill).join(", ")}` : ""}${m.notes ? "; notes combined" : ""}`
      + `${m.status ? `; stage → ${m.status}` : ""}${m.moveLink ? "; takes its Klaviyo link" : ""}${m.moveApproval ? "; takes its approval" : ""}`);
  }
  console.log(`\nPlanned emails to link to their Klaviyo campaign: ${plan.links.length}`);
  for (const l of plan.links) {
    const p = byId.get(l.emailId)!;
    console.log(`  ${p.sendDate}  #${p.id} “${p.subject}”  →  “${l.campaignName}” (${l.how}${l.how === "similar" ? ` ${l.score}` : ""})`);
  }

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to do it.");
    return;
  }

  for (const m of plan.merges) {
    await db.transaction(async tx => {
      const [keep] = await tx.select().from(marketingEmailsTable).where(eq(marketingEmailsTable.id, m.keepId)).for("update");
      const [drop] = await tx.select().from(marketingEmailsTable).where(eq(marketingEmailsTable.id, m.dropId)).for("update");
      if (!keep || !drop || keep.deletedAt || drop.deletedAt) return;
      // The link moves first (one live plan per Klaviyo campaign).
      if (m.moveLink) {
        await tx.update(marketingEmailsTable).set({ klaviyoCampaignId: null, klaviyoCampaignName: null }).where(eq(marketingEmailsTable.id, drop.id));
      }
      await tx.update(marketingEmailsTable).set({
        ...m.fill,
        ...(m.notes != null ? { notes: m.notes } : {}),
        ...(m.status ? { status: m.status } : {}),
        ...(m.moveLink ? { klaviyoCampaignId: m.moveLink.id, klaviyoCampaignName: m.moveLink.name } : {}),
        updatedById: null, updatedByName: SCRIPT_USER.name, updatedAt: new Date(),
      }).where(eq(marketingEmailsTable.id, keep.id));
      if (m.moveApproval) {
        await tx.update(marketingEmailApprovalsTable).set({ targetKey: `plan:${keep.id}`, emailId: keep.id, updatedAt: new Date() })
          .where(eq(marketingEmailApprovalsTable.targetKey, `plan:${drop.id}`));
      }
      // Its history comes across, so nothing about it is lost.
      await tx.update(marketingEmailHistoryTable).set({ emailId: keep.id }).where(eq(marketingEmailHistoryTable.emailId, drop.id));
      await tx.insert(marketingEmailHistoryTable).values({
        emailId: keep.id, userId: null, userName: SCRIPT_USER.name, action: "edited",
        summary: `merged in the duplicate “${drop.subject}” (#${drop.id}) — one email, one row`,
        changes: { mergedFrom: { from: String(drop.id), to: String(keep.id) } },
      });
      await tx.update(marketingEmailsTable).set({ deletedAt: new Date(), deletedById: null, deletedByName: SCRIPT_USER.name })
        .where(eq(marketingEmailsTable.id, drop.id));
      await tx.insert(marketingEmailHistoryTable).values({
        emailId: drop.id, userId: null, userName: SCRIPT_USER.name, action: "deleted",
        summary: `merged into “${keep.subject}” (#${keep.id})`,
      });
    });
  }
  let linked = 0;
  for (const l of plan.links) {
    const r = await db.transaction(tx => setPlannedEmailKlaviyoLink(tx, {
      emailId: l.emailId, klaviyoCampaignId: l.campaignId, klaviyoCampaignName: l.campaignName, user: SCRIPT_USER,
      auto: {
        summary: `linked to the Klaviyo email “${l.campaignName}” (tidy-up: ${l.how === "exact" ? "same campaign name" : "same day, similar name"})`,
        matched: `campaign name “${l.campaignName}”`, score: l.score,
      },
    }));
    if (r.status === 200) linked++;
  }
  console.log(`\nApplied: ${plan.merges.length} merged, ${linked} linked.`);
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => pool.end());
