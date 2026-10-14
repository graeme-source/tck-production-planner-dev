import { pgTable, serial, text, integer, smallint, timestamp, date, boolean, jsonb, unique, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Team lists (migration 0187): shared recurring routines that belong to a
// role, not a person — anyone ticked on one can open it and tick it as themselves.
// The recurrence JSON is a lib/recurrence RecurrenceRule.

export const teamListsTable = pgTable("team_lists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  emoji: text("emoji"),
  color: text("color"),
  /** Who can open the list (any role) — admins always can. Empty = admins only
   *  (Graeme, 2026-10-14: "if I tick, you've got access"). */
  memberIds: integer("member_ids").array().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  archivedAt: timestamp("archived_at"),
  archivedById: integer("archived_by_id").references(() => usersTable.id, { onDelete: "set null" }),
});

export const teamListItemsTable = pgTable("team_list_items", {
  id: serial("id").primaryKey(),
  listId: integer("list_id").notNull().references(() => teamListsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  notes: text("notes"),
  url: text("url"),
  /** 1 = P1 (most urgent) … 4 = P4, as in Todoist. */
  priority: smallint("priority").notNull().default(4),
  recurrence: jsonb("recurrence").notNull().default({ kind: "daily" }),
  /** "HH:MM", London time; null = any time. */
  timeOfDay: text("time_of_day"),
  carryOver: boolean("carry_over").notNull().default(false),
  /** Occurrences before this London date are ignored. */
  startDate: date("start_date").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("team_list_items_list_idx").on(t.listId)]);

export const teamListCompletionsTable = pgTable("team_list_completions", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => teamListItemsTable.id, { onDelete: "cascade" }),
  /** The occurrence this closes (London date), not the day it was ticked. */
  dueDate: date("due_date").notNull(),
  /** done | skipped */
  status: text("status").notNull().default("done"),
  byUserId: integer("by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  byName: text("by_name"),
  at: timestamp("at").notNull().defaultNow(),
}, (t) => [
  unique("team_list_completions_item_date").on(t.itemId, t.dueDate),
  index("team_list_completions_date_idx").on(t.dueDate),
]);

export type TeamList = typeof teamListsTable.$inferSelect;
export type TeamListItem = typeof teamListItemsTable.$inferSelect;
export type TeamListCompletion = typeof teamListCompletionsTable.$inferSelect;
