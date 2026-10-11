/**
 * Ad spend from channels other than Meta (migration 0169, Graeme
 * 2026-10-11). Objective I.
 *
 * founder_ad_spend (raw SQL, routes/founder-ad-spend.ts) is the Meta
 * channel — synced from Meta or typed by hand. Google Ads spend arrives
 * from a Google Ads Script (routes/google-ads-ingest.ts) into
 * ad_spend_channel_days; a day's total is the sum
 * (artifacts/api-server/src/lib/ad-spend-channels.ts). A hand-typed
 * ('manual') row for a day + channel is never overwritten by the script.
 *
 * ad_spend_ingest_links holds the script's connection key (sha256 only —
 * the key is shown once) and what it last sent.
 */
import { pgTable, text, numeric, timestamp, date, integer, primaryKey, index } from "drizzle-orm/pg-core";

export const adSpendChannelDaysTable = pgTable("ad_spend_channel_days", {
  spendDate: date("spend_date").notNull(),
  channel: text("channel").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  source: text("source").notNull(),
  accountId: text("account_id"),
  receivedAt: timestamp("received_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.spendDate, t.channel] }),
  index("ad_spend_channel_days_channel_date_idx").on(t.channel, t.spendDate),
]);

export const adSpendIngestLinksTable = pgTable("ad_spend_ingest_links", {
  channel: text("channel").primaryKey(),
  tokenHash: text("token_hash"),
  tokenHint: text("token_hint"),
  tokenCreatedAt: timestamp("token_created_at"),
  tokenCreatedByName: text("token_created_by_name"),
  lastReceivedAt: timestamp("last_received_at"),
  lastDayCount: integer("last_day_count"),
  lastFrom: date("last_from"),
  lastTo: date("last_to"),
  lastAccountId: text("last_account_id"),
  lastTimeZone: text("last_time_zone"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
