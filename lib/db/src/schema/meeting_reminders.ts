import { pgTable, serial, integer, date, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Standing morning-meeting reminders — show on every meeting from
 * `startsOn` until removed (soft remove, kept for audit). Migration 0250.
 * Rules: api-server lib/meeting-reminders.ts.
 */
export const meetingRemindersTable = pgTable("meeting_reminders", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  forWhom: text("for_whom"),
  startsOn: date("starts_on").notNull(),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  removedAt: timestamp("removed_at"),
  removedByUserId: integer("removed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  removedByName: text("removed_by_name"),
});

export type MeetingReminder = typeof meetingRemindersTable.$inferSelect;
