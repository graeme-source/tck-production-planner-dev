import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Timing data card: dismiss a suggested build/cook time, or send it to
// someone to review (migration 0195). One row per action; a dismissal is
// only ever updated to mark it restored.
export const timingSuggestionReviewsTable = pgTable("timing_suggestion_reviews", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // 'build' | 'cook' (CHECK in the migration)
  targetId: integer("target_id").notNull(), // recipe id (build) / ingredient id (cook)
  action: text("action").notNull(), // 'dismissed' | 'sent'
  setValue: integer("set_value"), // seconds (build) / minutes (cook)
  suggestedValue: integer("suggested_value"),
  assigneeId: integer("assignee_id").references(() => usersTable.id, { onDelete: "set null" }),
  assigneeName: text("assignee_name"),
  todoTaskId: integer("todo_task_id"),
  note: text("note"),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  actorName: text("actor_name"),
  restoredAt: timestamp("restored_at", { withTimezone: true }),
  restoredByName: text("restored_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("timing_suggestion_reviews_target_idx").on(t.kind, t.targetId)]);

export type TimingSuggestionReview = typeof timingSuggestionReviewsTable.$inferSelect;
