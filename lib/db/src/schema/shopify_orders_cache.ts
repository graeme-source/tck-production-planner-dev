/**
 * Local mirror of Shopify orders, kept fresh by INCREMENTAL sync.
 *
 * Why: the founder Numbers page (and P&L, surveys audience, delivery
 * planning) used to re-crawl the whole month of orders from Shopify's API on
 * every load — 250 orders per page, several endpoints in parallel, ~10s.
 * Instead we mirror orders here once, then each request only asks Shopify
 * "what changed since last sync?" (updated_at cursor — which also catches
 * refunds, cancellations and tag edits, not just new orders) and reads the
 * requested range straight from Postgres.
 *
 * The payload is the ShopifyOrder JSON exactly as the REST API returned it
 * (superset fields incl. line_items), so consumers see identical data to a
 * direct fetch. created_at/updated_at are duplicated into real columns for
 * range queries and the sync cursor.
 */
import { pgTable, bigint, integer, timestamp, jsonb, index, date } from "drizzle-orm/pg-core";

export const shopifyOrdersCacheTable = pgTable("shopify_orders_cache", {
  // Shopify order id (exceeds int4).
  id: bigint("id", { mode: "number" }).primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  payload: jsonb("payload").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  createdIdx: index("ix_shopify_orders_cache_created").on(t.createdAt),
}));

// Single-row sync state (id always 1). coverage_start marks how far back the
// mirror is complete — ranges starting earlier trigger a one-off backfill.
export const shopifyOrdersSyncTable = pgTable("shopify_orders_sync", {
  id: integer("id").primaryKey(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  coverageStart: date("coverage_start"),
});

export type ShopifyOrderCacheRow = typeof shopifyOrdersCacheTable.$inferSelect;
