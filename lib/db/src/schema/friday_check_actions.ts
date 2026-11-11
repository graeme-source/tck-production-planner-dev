import { pgTable, serial, text, integer, bigint, date, timestamp, index } from "drizzle-orm/pg-core";

// What was done from the Friday dispatch check (migration 0367): the
// customer emailed, or the order moved to another dispatch day. Rules in
// api-server/src/lib/friday-dispatch-check.ts. Append-only.
export const fridayCheckActionsTable = pgTable("friday_check_actions", {
  id: serial("id").primaryKey(),
  /** The Friday the order was due out on. */
  dispatchDate: date("dispatch_date").notNull(),
  shopifyOrderId: bigint("shopify_order_id", { mode: "number" }).notNull(),
  orderName: text("order_name").notNull(),
  /** emailed | moved */
  kind: text("kind").notNull(),
  /** emailed: the address; moved: the new delivery-date tag. */
  detail: text("detail"),
  byUserId: integer("by_user_id"),
  byName: text("by_name"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_friday_check_actions_day").on(t.dispatchDate, t.shopifyOrderId),
]);

export type FridayCheckAction = typeof fridayCheckActionsTable.$inferSelect;
