import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { purchaseOrdersTable } from "./ordering";
import { teamListsTable, teamListItemsTable } from "./team_lists";

// Short-delivery reports (migration 0196): one row per delivery that came in
// short, so a re-save sends nothing new and a later edit sends one follow-up.
// Rules: lib/goods-in (pure); writes: api-server lib/short-delivery-report.ts.
export const shortDeliveryReportsTable = pgTable("short_delivery_reports", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").notNull().unique().references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
  /** The shortfall last reported — lib/goods-in shortSignature(). */
  signature: text("signature").notNull().default(""),
  teamListId: integer("team_list_id").references(() => teamListsTable.id, { onDelete: "set null" }),
  teamListItemId: integer("team_list_item_id").references(() => teamListItemsTable.id, { onDelete: "set null" }),
  /** People given a to-do about this delivery so far. */
  recipientIds: integer("recipient_ids").array().notNull().default([]),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ShortDeliveryReport = typeof shortDeliveryReportsTable.$inferSelect;
