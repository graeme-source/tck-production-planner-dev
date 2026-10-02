import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Contacts directory (migration 0143). Supplier contact details are NOT
// stored here — they stay on suppliers and the directory reads them.
// use_for is a stable machine key a feature looks its contact up by
// (e.g. 'apc_customer_service'), so no name or number is hard-coded.
export const contactsTable = pgTable("contacts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  organisation: text("organisation"),
  role: text("role"),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  /** emergency | carrier | service | supplier | other */
  category: text("category").notNull().default("other"),
  /** Station keys the app already uses (packing, ovens, …). */
  stationKeys: text("station_keys").array().notNull().default([]),
  /** Also shown as an always-visible chip on those stations. */
  pinned: boolean("pinned").notNull().default(false),
  useFor: text("use_for"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedById: integer("deleted_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  deletedByName: text("deleted_by_name"),
});

export type Contact = typeof contactsTable.$inferSelect;
