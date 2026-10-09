/**
 * Runs the Klaviyo auto-linker (rules: klaviyo-auto-link.ts) — Graeme,
 * 2026-10-09: a planned email and the Klaviyo email Tommy builds for it link
 * themselves. Objective H.
 *
 * Called when the calendar loads Klaviyo emails (GET
 * /marketing-calendar/klaviyo-emails). Cheap: Klaviyo comes from the
 * existing 3-minute caches, and a run is reused for RUN_EVERY_MS, so the
 * calendar's once-a-minute refresh by several people still means at most
 * one run a minute. Writes only OUR database (marketing_emails + history +
 * approval carry-over) through the same function as the manual link —
 * never Klaviyo.
 */
import { db, marketingEmailsTable, marketingEmailHistoryTable } from "@workspace/db";
import { and, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { addDays } from "@workspace/marketing-calendar";
import { klaviyoCampaignsForMatching } from "./klaviyo-campaign-calendar";
import { describeAutoLink, matchKlaviyoToPlans, unlinkedPairsFrom, type PairMatch } from "./klaviyo-auto-link";
import { setPlannedEmailKlaviyoLink } from "./marketing-email-klaviyo-link";

const RUN_EVERY_MS = 60_000;
/** Plans that sent (or were due) longer ago than this are left alone. */
const PLAN_LOOKBACK_DAYS = 45;
/** Same as the matcher's limit for scheduled / sent emails. */
const SEND_WINDOW_DAYS = 21;
export const AUTO_LINK_USER = { id: null, name: "Auto-link" } as const;

export interface AutoLinkSuggestion {
  emailId: number;
  campaignId: string;
  campaignName: string;
  campaignStatus: PairMatch["campaignStatus"];
  /** e.g. name “Black Friday – early access” */
  matched: string;
  score: number;
}
export interface AutoLinkOutcome {
  autoLinked: Array<{ emailId: number; campaignId: string; campaignName: string; matched: string }>;
  suggestions: AutoLinkSuggestion[];
}

const EMPTY: AutoLinkOutcome = { autoLinked: [], suggestions: [] };
let last: { at: number; outcome: AutoLinkOutcome } | null = null;
let running: Promise<AutoLinkOutcome> | null = null;

/** After a manual link / unlink the next look re-runs rather than reusing. */
export function forgetAutoLinkRun(): void { last = null; }

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

function matchedText(m: PairMatch): string {
  return `${m.field === "name" ? "name" : "subject line"} “${m.fieldText}”`;
}

async function runOnce(): Promise<AutoLinkOutcome> {
  const since = addDays(londonToday(), -PLAN_LOOKBACK_DAYS);
  const campaigns = await klaviyoCampaignsForMatching(addDays(since, -SEND_WINDOW_DAYS));
  if (!campaigns || campaigns.length === 0) return EMPTY;

  const [plans, linkedRows] = await Promise.all([
    db.select({
      id: marketingEmailsTable.id, subject: marketingEmailsTable.subject, sendDate: marketingEmailsTable.sendDate,
      klaviyoCampaignId: marketingEmailsTable.klaviyoCampaignId,
    }).from(marketingEmailsTable)
      .where(and(isNull(marketingEmailsTable.deletedAt), isNull(marketingEmailsTable.klaviyoCampaignId), gte(marketingEmailsTable.sendDate, since))),
    db.select({ id: marketingEmailsTable.klaviyoCampaignId }).from(marketingEmailsTable)
      .where(and(isNull(marketingEmailsTable.deletedAt), isNotNull(marketingEmailsTable.klaviyoCampaignId))),
  ]);
  if (plans.length === 0) return EMPTY;
  const history = await db.select({ emailId: marketingEmailHistoryTable.emailId, changes: marketingEmailHistoryTable.changes })
    .from(marketingEmailHistoryTable)
    .where(and(
      inArray(marketingEmailHistoryTable.emailId, plans.map(p => p.id)),
      sql`${marketingEmailHistoryTable.changes} -> 'klaviyoCampaignId' IS NOT NULL`,
    ));

  const result = matchKlaviyoToPlans({
    plans,
    campaigns,
    linkedCampaignIds: linkedRows.map(r => r.id).filter((x): x is string => !!x),
    unlinkedPairs: unlinkedPairsFrom(history),
  });

  const autoLinked: AutoLinkOutcome["autoLinked"] = [];
  for (const m of result.links) {
    const matched = matchedText(m);
    const r = await db.transaction(tx => setPlannedEmailKlaviyoLink(tx, {
      emailId: m.emailId, klaviyoCampaignId: m.campaignId, klaviyoCampaignName: m.campaignName, user: AUTO_LINK_USER,
      auto: { summary: describeAutoLink(m), matched, score: m.score },
    }));
    // 404 / 409: deleted or linked by someone in the meantime — theirs stands.
    if (r.status === 200) autoLinked.push({ emailId: m.emailId, campaignId: m.campaignId, campaignName: m.campaignName, matched });
  }
  return {
    autoLinked,
    suggestions: result.suggestions.map(s => ({
      emailId: s.emailId, campaignId: s.campaignId, campaignName: s.campaignName, campaignStatus: s.campaignStatus,
      matched: matchedText(s), score: s.score,
    })),
  };
}

/** Link what clearly matches; return the rest as suggestions. A run's
 *  `autoLinked` is only reported once (later reuses report none). */
export async function runKlaviyoAutoLink(): Promise<AutoLinkOutcome> {
  if (last && Date.now() - last.at < RUN_EVERY_MS) return { autoLinked: [], suggestions: last.outcome.suggestions };
  if (running) return running;
  running = runOnce()
    .then(outcome => { last = { at: Date.now(), outcome }; return outcome; })
    .finally(() => { running = null; });
  return running;
}
