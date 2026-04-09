import { pgTable, bigint, timestamp, text } from "drizzle-orm/pg-core";

/**
 * Idempotency log for the factory-number fulfilment decrement.
 *
 * Both the immediate "Confirm & Complete" path and the 5-minute
 * safety-net poller dedupe through this table: before decrementing,
 * they insert a row with shopify_order_id as the primary key (so
 * duplicate inserts are rejected), and only then apply the stock
 * decrement. The `source` column lets us trace whether a particular
 * order was captured by the UI path or the poller.
 */
export const shopifyFulfilmentTrackingTable = pgTable("shopify_fulfilment_tracking", {
  shopifyOrderId: bigint("shopify_order_id", { mode: "number" }).primaryKey(),
  fulfilledAt: timestamp("fulfilled_at").notNull(),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
  source: text("source").notNull(), // "immediate" | "poller" | "startup-seed"
});
