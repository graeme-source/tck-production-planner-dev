import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { andonIssuesTable, improvementSubmissionsTable } from "./improvements_and_andon";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "comment" | "acknowledged" | "resolved" | "broadcast" | "improvement"
  message: text("message").notNull(),
  andonIssueId: integer("andon_issue_id").references(() => andonIssuesTable.id, { onDelete: "cascade" }),
  // The improvement a notification is about (migration 0069) — the bell
  // deep-links to it. Comments and ratings use it; the team-wide
  // "improvement" celebration rows stopped on 27 Oct 2026.
  improvementId: integer("improvement_id").references(() => improvementSubmissionsTable.id, { onDelete: "cascade" }),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
