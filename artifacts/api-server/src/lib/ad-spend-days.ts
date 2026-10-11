/**
 * Reads every ad-spend channel for a span of days and combines them
 * (lib/ad-spend-channels.ts). The ONE read behind every ROAS on the
 * Numbers page: GET /api/founder-focus/ad-spend/range (Order Analysis tile,
 * At a Glance cards' source line) and GET /api/founder-numbers/trend (the
 * graphs and the At a Glance ROAS cards). Objective I.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { combineChannelSpend, type CombinedSpendDay } from "./ad-spend-channels";
import { GOOGLE_CHANNEL } from "./google-ads-spend";

/** DATE columns may come back as a Date depending on the pg parser. */
function ymd(v: string | Date): string {
  return typeof v === "string" ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10);
}

const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);

export interface SpendDaysResult {
  days: CombinedSpendDay[];
  /** The first day Google Ads has ever sent, or null if it never has. */
  googleFirstDate: string | null;
}

export async function loadSpendDays(from: string, to: string): Promise<SpendDaysResult> {
  const metaRows = await db.execute<{ spend_date: string | Date; amount: string; source: string | null; synced_at: Date | null }>(sql`
    SELECT spend_date, amount, source, synced_at
      FROM founder_ad_spend
     WHERE spend_date >= ${from} AND spend_date <= ${to}
     ORDER BY spend_date ASC
  `);

  const [googleRows, first] = await Promise.all([
    db.execute<{ spend_date: string | Date; amount: string; source: string; received_at: Date | null }>(sql`
      SELECT spend_date, amount, source, received_at
        FROM ad_spend_channel_days
       WHERE channel = ${GOOGLE_CHANNEL} AND spend_date >= ${from} AND spend_date <= ${to}
       ORDER BY spend_date ASC
    `),
    db.execute<{ d: string | null }>(sql`
      SELECT MIN(spend_date)::text AS d FROM ad_spend_channel_days WHERE channel = ${GOOGLE_CHANNEL}
    `),
  ]);

  const googleFirstDate = first.rows[0]?.d ?? null;
  return {
    googleFirstDate,
    days: combineChannelSpend({
      meta: metaRows.rows
        .filter(r => r.amount != null)
        .map(r => ({ date: ymd(r.spend_date), amount: Number(r.amount), source: r.source ?? "manual", syncedAt: iso(r.synced_at) })),
      google: googleRows.rows.map(r => ({
        date: ymd(r.spend_date), amount: Number(r.amount), source: r.source, receivedAt: iso(r.received_at),
      })),
      googleFirstDate,
    }),
  };
}
