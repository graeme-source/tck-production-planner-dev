/**
 * Marry Klaviyo campaigns to the email plan by CAMPAIGN NAME (Graeme,
 * 2026-10-14) — runs first inside the Klaviyo auto-link run, before the
 * older subject-line linker. Objective I.
 *
 * Targets: every live, unlinked planned email (its suggested campaign name),
 * and every cycle slot nobody has touched yet (no stored row and no planner
 * email replacing it that day). Rules: matchCampaignsToTargets in
 * @workspace/marketing-calendar — exact name, else same day + similar name.
 * A matched slot is made into a stored planned email, then linked, through
 * the same link function as the manual "Link" button (history line,
 * approval carried over). Writes only OUR database; never Klaviyo.
 */
import { db, marketingEmailsTable, marketingEmailHistoryTable, marketingEventsTable } from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  PHASE_EVENT_TYPE, addDays, campaignForDate, cycleSlotsBetween, describeNameMatch, matchCampaignsToTargets, plannedCampaignName,
  type MatchTarget,
} from "@workspace/marketing-calendar";
import type { KlaviyoCalendarEmail } from "./klaviyo-campaign-calendar";
import { loadCycle, loadProducts, materialiseSlot } from "./email-cycle-data";
import { setPlannedEmailKlaviyoLink } from "./marketing-email-klaviyo-link";
import { unlinkedPairsFrom } from "./klaviyo-auto-link";

/** How far back and ahead plans and slots are considered. */
const BACK_DAYS = 45;
const AHEAD_DAYS = 180;

export interface NameLinkOutcome { emailId: number; campaignId: string; campaignName: string; matched: string }

export async function linkByCampaignName(campaigns: readonly KlaviyoCalendarEmail[], today: string, user: { id: null; name: string }): Promise<NameLinkOutcome[]> {
  const from = addDays(today, -BACK_DAYS), to = addDays(today, AHEAD_DAYS);
  const [plans, linkedRows, phases, cycle, products] = await Promise.all([
    db.select().from(marketingEmailsTable)
      .where(and(isNull(marketingEmailsTable.deletedAt), gte(marketingEmailsTable.sendDate, from), lte(marketingEmailsTable.sendDate, to))),
    db.select({ id: marketingEmailsTable.klaviyoCampaignId }).from(marketingEmailsTable)
      .where(and(isNull(marketingEmailsTable.deletedAt), isNotNull(marketingEmailsTable.klaviyoCampaignId))),
    db.select({ id: marketingEventsTable.id, title: marketingEventsTable.name, startDate: marketingEventsTable.startDate, endDate: marketingEventsTable.endDate })
      .from(marketingEventsTable)
      .where(and(isNull(marketingEventsTable.deletedAt), eq(marketingEventsTable.eventType, PHASE_EVENT_TYPE), gte(marketingEventsTable.endDate, from), lte(marketingEventsTable.startDate, to))),
    loadCycle(),
    loadProducts(from, to),
  ]);

  // Slot days already taken: a stored slot row, or a planner email that day.
  const taken = new Set<string>();
  for (const p of plans) { taken.add(p.cycleDate ?? p.sendDate); }
  const targets: MatchTarget[] = [];
  for (const p of plans) {
    if (p.klaviyoCampaignId) continue;
    const phase = campaignForDate(p.sendDate, phases);
    targets.push({
      key: `plan:${p.id}`, date: p.sendDate, subject: p.subject,
      expectedName: p.campaignName ?? plannedCampaignName(p.sendDate, phase?.title ?? null, p.subject),
    });
  }
  for (const s of cycleSlotsBetween(from, to, cycle.config, products)) {
    if (taken.has(s.date)) continue;
    targets.push({ key: `slot:${s.date}`, date: s.date, subject: s.subject, expectedName: s.campaignName, strict: true });
  }
  if (targets.length === 0) return [];

  const planIds = plans.map(p => p.id);
  const history = planIds.length
    ? await db.select({ emailId: marketingEmailHistoryTable.emailId, changes: marketingEmailHistoryTable.changes })
      .from(marketingEmailHistoryTable)
      .where(and(inArray(marketingEmailHistoryTable.emailId, planIds), sql`${marketingEmailHistoryTable.changes} -> 'klaviyoCampaignId' IS NOT NULL`))
    : [];
  const rejected = unlinkedPairsFrom(history).map(r => ({ targetKey: `plan:${r.emailId}`, campaignId: r.campaignId }));
  // A slot once made real and unlinked is a plan now, so its "no" is above.

  const { matches } = matchCampaignsToTargets({
    targets, campaigns, rejected,
    linkedCampaignIds: linkedRows.map(r => r.id).filter((x): x is string => !!x),
  });

  const out: NameLinkOutcome[] = [];
  for (const m of matches) {
    const matched = `campaign name “${m.campaignName}”`;
    const r = await db.transaction(async tx => {
      let emailId: number;
      if (m.targetKey.startsWith("slot:")) {
        const made = await materialiseSlot(tx, m.targetKey.slice(5), user, "when Klaviyo's campaign matched it");
        if (made.status !== 200) return null;
        emailId = made.row.id;
      } else emailId = Number(m.targetKey.slice(5));
      const link = await setPlannedEmailKlaviyoLink(tx, {
        emailId, klaviyoCampaignId: m.campaignId, klaviyoCampaignName: m.campaignName, user,
        auto: { summary: describeNameMatch(m), matched, score: m.score },
      });
      return link.status === 200 ? emailId : null;
    });
    if (r != null) out.push({ emailId: r, campaignId: m.campaignId, campaignName: m.campaignName, matched });
  }
  return out;
}
