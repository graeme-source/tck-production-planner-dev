import { pgTable, serial, text, integer, timestamp, pgEnum, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const improvementApprovalTierEnum = pgEnum("improvement_approval_tier", ["minor", "medium", "major"]);
// Only "submitted_for_review" (shown as "Submitted") and "complete" are used
// now — the intermediate statuses were collapsed in July 2026. The extra enum
// values must stay listed because Postgres enums can't drop values cheaply.
// The states that actually matter (migration 0059), in the order an
// improvement moves through them:
//   submitted_for_review — logged, still to do. The default, and what every
//                          row already on live means.
//   awaiting_approval    — the person says they've done it; a manager checks.
//   complete             — approved. This is the one that counts for someone.
//   rejected             — sent back with a note.
// The rest (acknowledged, approved, in_development, testing) are dead values
// from the July 2026 collapse. They must stay listed because Postgres can't
// drop enum values cheaply; nothing writes them.
export const improvementProgressStatusEnum = pgEnum("improvement_progress_status", [
  "submitted_for_review",
  "acknowledged",
  "approved",
  "in_development",
  "testing",
  "complete",
  "rejected",
  "awaiting_approval",
]);

export const improvementSubmissionsTable = pgTable("improvement_submissions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  station: text("station").notNull(),
  type: text("type").notNull().default("improvement"),
  submittedBy: integer("submitted_by").references(() => usersTable.id, { onDelete: "set null" }),
  submittedByName: text("submitted_by_name"),
  // Defaults to the submitter on creation; managers can reassign afterwards.
  assignedTo: integer("assigned_to").references(() => usersTable.id, { onDelete: "set null" }),
  assignedToName: text("assigned_to_name"),
  approvalTier: improvementApprovalTierEnum("approval_tier"),
  progressStatus: improvementProgressStatusEnum("progress_status").notNull().default("submitted_for_review"),
  notes: text("notes"),
  reportContext: text("report_context"),
  // Approval trail (migration 0059).
  approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
  approvedByName: text("approved_by_name"),
  approvedAt: timestamp("approved_at"),
  // Who carried it out — defaults to whoever logged it, but a manager can
  // move the credit on approval.
  creditedTo: integer("credited_to").references(() => usersTable.id, { onDelete: "set null" }),
  creditedToName: text("credited_to_name"),
  // Why it was sent back, and when the person said it was done.
  reviewNote: text("review_note"),
  doneAt: timestamp("done_at"),
  // Which lean subject this improvement is an example of (migration 0061).
  // Linked to the subject, not a week: subjects are stable, weeks get
  // re-ordered in the curriculum planner. subjectSource is 'ai' for an
  // automatic suggestion and 'human' once someone has confirmed it, so an
  // unreviewed guess is never mistaken for a decision.
  subjectId: integer("subject_id"),
  subjectSource: text("subject_source"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const andonSeverityEnum = pgEnum("andon_severity", ["yellow", "red", "green"]);
export const andonCategoryEnum = pgEnum("andon_category", ["equipment", "safety", "production", "product", "other"]);

export const andonIssuesTable = pgTable("andon_issues", {
  id: serial("id").primaryKey(),
  category: andonCategoryEnum("category").notNull(),
  severity: andonSeverityEnum("severity").notNull(),
  description: text("description"),
  station: text("station").notNull(),
  reportedBy: integer("reported_by").references(() => usersTable.id, { onDelete: "set null" }),
  reportedByName: text("reported_by_name"),
  reportContext: text("report_context"),
  acknowledgedBy: integer("acknowledged_by").references(() => usersTable.id, { onDelete: "set null" }),
  acknowledgedByName: text("acknowledged_by_name"),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedBy: integer("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
  resolvedByName: text("resolved_by_name"),
  resolvedAt: timestamp("resolved_at"),
  // 'factory' = something physical on the floor, 'system' = something wrong
  // with the app on the iPad. They go to different people (migration 0060).
  area: text("area"),
  // Set when this issue was turned into an improvement — a safety problem
  // gets fixed by improving something, and the pair stays joined up.
  improvementId: integer("improvement_id").references(() => improvementSubmissionsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertImprovementSubmissionSchema = createInsertSchema(improvementSubmissionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAndonIssueSchema = createInsertSchema(andonIssuesTable).omit({
  id: true,
  createdAt: true,
  acknowledgedBy: true,
  acknowledgedByName: true,
  acknowledgedAt: true,
  resolvedBy: true,
  resolvedByName: true,
  resolvedAt: true,
});

// One vote per person per improvement (migration 0061). A duplicate report
// becomes a vote instead of a second copy, so the count measures how many
// people a problem actually affects.
export const improvementVotesTable = pgTable("improvement_votes", {
  id: serial("id").primaryKey(),
  improvementId: integer("improvement_id").notNull().references(() => improvementSubmissionsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_improvement_vote").on(table.improvementId, table.userId),
]);

export const improvementCommentsTable = pgTable("improvement_comments", {
  id: serial("id").primaryKey(),
  improvementId: integer("improvement_id").notNull().references(() => improvementSubmissionsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name"),
  comment: text("comment").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const andonCommentsTable = pgTable("andon_comments", {
  id: serial("id").primaryKey(),
  andonId: integer("andon_id").notNull().references(() => andonIssuesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name"),
  comment: text("comment").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ImprovementSubmission = typeof improvementSubmissionsTable.$inferSelect;
export type AndonIssue = typeof andonIssuesTable.$inferSelect;
export type ImprovementComment = typeof improvementCommentsTable.$inferSelect;
export type AndonComment = typeof andonCommentsTable.$inferSelect;
export type InsertImprovementSubmission = z.infer<typeof insertImprovementSubmissionSchema>;
export type InsertAndonIssue = z.infer<typeof insertAndonIssueSchema>;

// Who has opened which improvement. Absence of a row means "not seen yet",
// so a newly logged improvement is unseen by everyone without having to
// write a row per person up front. Drives the count badge on the
// Improvements nav item (migration 0072).
export const improvementViewsTable = pgTable("improvement_views", {
  id: serial("id").primaryKey(),
  improvementId: integer("improvement_id").notNull().references(() => improvementSubmissionsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  viewedAt: timestamp("viewed_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_improvement_view").on(table.improvementId, table.userId),
]);

export type ImprovementView = typeof improvementViewsTable.$inferSelect;
