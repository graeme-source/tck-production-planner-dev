/**
 * The saved copy of SENT Klaviyo email campaigns (migration 0378; Graeme,
 * 18 Nov 2026: "we're just looking ... if anything's changed since the last
 * email"). Asking Klaviyo for a year of campaigns took ~29 s whenever its
 * 3-minute cache ran out, so Reasons to Buy reads the year from here. The
 * copy is topped up from Klaviyo in the background — only from a few days
 * before the newest saved send (sentSyncFrom) — at most every 10 minutes.
 * The very first time (nothing saved) the year is fetched once, and that
 * call waits for it.
 *
 * Klaviyo stays the master: READ-ONLY towards Klaviyo; this table is ours.
 * A campaign deleted in Klaviyo after it was sent stays here (rare; it was
 * still sent).
 */
import { db, klaviyoSentCampaignsTable } from "@workspace/db";
import { and, asc, gte, lte, sql } from "drizzle-orm";
import { addDays, sentSyncFrom } from "@workspace/marketing-calendar";
import { getKlaviyoKey, klaviyoSentSince } from "./klaviyo-campaign-calendar";

/** One sent campaign, as the saved copy holds it. */
export interface SentCampaign {
  id: string;
  /** London day it sent. */
  date: string;
  sendAt: string | null;
  name: string;
  subject: string | null;
  previewText: string | null;
  klaviyoUrl: string;
}

const TOP_UP_EVERY_MS = 10 * 60_000;
let lastTopUp = 0;
let toppingUp: Promise<void> | null = null;

const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

async function newestSaved(): Promise<string | null> {
  const r = await db.execute<{ d: string | null }>(sql`SELECT max(send_day) AS d FROM klaviyo_sent_campaigns`);
  return r.rows[0]?.d ?? null;
}

/** Ask Klaviyo for what's been sent since a few days before the newest
 *  saved send (the whole lookback the first time) and save it. */
export function topUpSentCampaigns(lookbackDays: number): Promise<void> {
  toppingUp ??= (async () => {
    const since = sentSyncFrom(await newestSaved(), londonToday(), lookbackDays);
    const sent = await klaviyoSentSince(since);
    lastTopUp = Date.now();
    if (!sent?.length) return;
    for (let i = 0; i < sent.length; i += 200) {
      const rows = sent.slice(i, i + 200).map(c => ({
        campaignId: c.id, sendDay: c.date, sendAt: c.sendAt ? new Date(c.sendAt) : null, name: c.name,
        subject: c.subject, previewText: c.previewText, klaviyoUrl: c.klaviyoUrl, syncedAt: new Date(),
      }));
      await db.insert(klaviyoSentCampaignsTable).values(rows).onConflictDoUpdate({
        target: klaviyoSentCampaignsTable.campaignId,
        set: {
          sendDay: sql`excluded.send_day`, sendAt: sql`excluded.send_at`, name: sql`excluded.name`,
          subject: sql`excluded.subject`, previewText: sql`excluded.preview_text`,
          klaviyoUrl: sql`excluded.klaviyo_url`, syncedAt: sql`excluded.synced_at`,
        },
      });
    }
  })()
    .catch(err => {
      lastTopUp = Date.now(); // don't hammer Klaviyo after a failure; retry next window
      console.error("[klaviyo-sent] top-up failed:", err instanceof Error ? err.message : String(err));
    })
    .finally(() => { toppingUp = null; });
  return toppingUp;
}

/**
 * Sent campaigns from the last `lookbackDays` up to today, from the saved
 * copy. Tops the copy up in the background when it's due; waits only the
 * first time, when nothing is saved yet. null = Klaviyo isn't connected.
 */
export async function savedSentCampaigns(today: string, lookbackDays: number): Promise<SentCampaign[] | null> {
  if (!(await getKlaviyoKey())) return null;
  if (!(await newestSaved())) await topUpSentCampaigns(lookbackDays);
  else if (Date.now() - lastTopUp >= TOP_UP_EVERY_MS) void topUpSentCampaigns(lookbackDays);
  const rows = await db.select().from(klaviyoSentCampaignsTable)
    .where(and(gte(klaviyoSentCampaignsTable.sendDay, addDays(today, -lookbackDays)), lte(klaviyoSentCampaignsTable.sendDay, today)))
    .orderBy(asc(klaviyoSentCampaignsTable.sendDay));
  return rows.map(r => ({
    id: r.campaignId, date: r.sendDay, sendAt: r.sendAt?.toISOString() ?? null, name: r.name,
    subject: r.subject, previewText: r.previewText, klaviyoUrl: r.klaviyoUrl,
  }));
}
