import { pgTable, serial, text, integer, timestamp, date, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

// Marketing calendar (migrations 0043 + 0135). Planned together by the
// founder and the marketing team on the Sales & Marketing page. Column names
// predate the calendar: `name` is the event title, `offer` the offer details,
// `notes` the long notes, `source` 'manual' | 'ai' (who suggested it).
export const marketingEventsTable = pgTable("marketing_events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  summary: text("summary"),
  offer: text("offer"),
  notes: text("notes"),
  // campaign | email | offer | product_launch | seasonal | test_box | other
  eventType: text("event_type").notNull().default("campaign"),
  channels: text("channels").array().notNull().default(sql`'{}'::text[]`),
  audience: text("audience"),
  // idea | planned | live | done
  status: text("status").notNull().default("planned"),
  source: text("source").notNull().default("manual"),
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

export const marketingEventHistoryTable = pgTable("marketing_event_history", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => marketingEventsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name"),
  // created | edited | moved | resized | deleted
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  changes: jsonb("changes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type MarketingEvent = typeof marketingEventsTable.$inferSelect;
export type MarketingEventHistory = typeof marketingEventHistoryTable.$inferSelect;
