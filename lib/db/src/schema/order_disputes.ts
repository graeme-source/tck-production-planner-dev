import { pgTable, text, timestamp, bigint, integer } from "drizzle-orm/pg-core";

/**
 * Orders with an OPEN Shopify Payments dispute (chargeback or inquiry) —
 * migration 0207. A mirror of Shopify, replaced on every refresh; every
 * despatch path refuses an order listed here (api-server
 * lib/order-disputes-store.ts).
 */
export const openOrderDisputesTable = pgTable("open_order_disputes", {
  shopifyOrderId: bigint("shopify_order_id", { mode: "number" }).primaryKey(),
  orderName: text("order_name"),
  /** "chargeback:under_review" etc. — every open dispute on the order. */
  statuses: text("statuses").array().notNull().default([]),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Single row (id = 1): freshness of the dispute list. */
export const orderDisputeRefreshTable = pgTable("order_dispute_refresh", {
  id: integer("id").primaryKey().default(1),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }),
  lastError: text("last_error"),
});

export type OpenOrderDispute = typeof openOrderDisputesTable.$inferSelect;
