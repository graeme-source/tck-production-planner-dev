import { pgTable, serial, integer, date, text, timestamp, boolean, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Wish List — "Equipment & things we need" (migration 0260, Graeme 23 Oct
 * 2026). Rules: api-server lib/wish-list.ts; routes/wish-list.ts.
 */
export const wishListItemsTable = pgTable("wish_list_items", {
  id: serial("id").primaryKey(),
  url: text("url"),
  title: text("title").notNull(),
  pricePence: integer("price_pence"),
  priceIncludesVat: boolean("price_includes_vat"),
  priceExVatPence: integer("price_ex_vat_pence"),
  currency: text("currency").notNull().default("GBP"),
  imageUrl: text("image_url"),
  storeName: text("store_name"),
  notes: text("notes"),
  quantity: integer("quantity").notNull().default(1),
  status: text("status").notNull().default("requested"),
  statusNote: text("status_note"),
  statusChangedAt: timestamp("status_changed_at"),
  statusChangedByName: text("status_changed_by_name"),
  orderedAt: timestamp("ordered_at"),
  orderedByUserId: integer("ordered_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  orderedByName: text("ordered_by_name"),
  receivedAt: timestamp("received_at"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedByName: text("deleted_by_name"),
});

export const wishListVotesTable = pgTable("wish_list_votes", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => wishListItemsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  voteDate: date("vote_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => [unique("wish_list_votes_once_a_day").on(t.itemId, t.userId, t.voteDate)]);

export const wishListAlertAcksTable = pgTable("wish_list_alert_acks", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  ackedUpToId: integer("acked_up_to_id").notNull().default(0),
  ackedAt: timestamp("acked_at").notNull().defaultNow(),
});

export type WishListItem = typeof wishListItemsTable.$inferSelect;
export type WishListVote = typeof wishListVotesTable.$inferSelect;
