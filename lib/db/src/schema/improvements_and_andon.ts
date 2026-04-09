import { pgTable, serial, text, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const improvementApprovalTierEnum = pgEnum("improvement_approval_tier", ["minor", "medium", "major"]);
export const improvementProgressStatusEnum = pgEnum("improvement_progress_status", [
  "submitted_for_review",
  "acknowledged",
  "approved",
  "in_development",
  "testing",
  "complete",
  "rejected",
]);

export const andonSeverityEnum = pgEnum("andon_severity", ["yellow", "red"]);
export const andonCategoryEnum = pgEnum("andon_category", ["equipment", "safety", "production", "product", "other"]);

// Unified submissions table: holds improvements, struggles, and issues (formerly andon_issues).
// The `type` field distinguishes rows: "improvement" | "struggle" | "issue".
// Issue-specific columns (category, severity, acknowledged*, resolved*) are nullable
// and only populated for type="issue" rows.
export const improvementSubmissionsTable = pgTable("improvement_submissions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  station: text("station").notNull(),
  type: text("type").notNull().default("improvement"),
  submittedBy: integer("submitted_by").references(() => usersTable.id, { onDelete: "set null" }),
  submittedByName: text("submitted_by_name"),
  approvalTier: improvementApprovalTierEnum("approval_tier"),
  progressStatus: improvementProgressStatusEnum("progress_status").notNull().default("submitted_for_review"),
  notes: text("notes"),
  // Issue-specific fields (populated when type="issue")
  category: andonCategoryEnum("category"),
  severity: andonSeverityEnum("severity"),
  acknowledgedBy: integer("acknowledged_by").references(() => usersTable.id, { onDelete: "set null" }),
  acknowledgedByName: text("acknowledged_by_name"),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedBy: integer("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
  resolvedByName: text("resolved_by_name"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Comments on any submission (improvement, struggle, or issue).
export const improvementCommentsTable = pgTable(
  "improvement_comments",
  {
    id: serial("id").primaryKey(),
    submissionId: integer("submission_id")
      .notNull()
      .references(() => improvementSubmissionsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    userName: text("user_name"),
    comment: text("comment").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    submissionIdx: index("improvement_comments_submission_id_idx").on(t.submissionId),
  })
);

// Legacy table — retained temporarily for backfill. Once migration 0005 has run
// and downstream callers have been migrated to /api/improvements?type=issue, this
// table can be dropped in a follow-up schema change.
// @deprecated Use improvementSubmissionsTable with type="issue" instead.
export const andonIssuesTable = pgTable("andon_issues", {
  id: serial("id").primaryKey(),
  category: andonCategoryEnum("category").notNull(),
  severity: andonSeverityEnum("severity").notNull(),
  description: text("description"),
  station: text("station").notNull(),
  reportedBy: integer("reported_by").references(() => usersTable.id, { onDelete: "set null" }),
  reportedByName: text("reported_by_name"),
  acknowledgedBy: integer("acknowledged_by").references(() => usersTable.id, { onDelete: "set null" }),
  acknowledgedByName: text("acknowledged_by_name"),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedBy: integer("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
  resolvedByName: text("resolved_by_name"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertImprovementSubmissionSchema = createInsertSchema(improvementSubmissionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertImprovementCommentSchema = createInsertSchema(improvementCommentsTable).omit({
  id: true,
  createdAt: true,
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

export type ImprovementSubmission = typeof improvementSubmissionsTable.$inferSelect;
export type ImprovementComment = typeof improvementCommentsTable.$inferSelect;
export type AndonIssue = typeof andonIssuesTable.$inferSelect;
export type InsertImprovementSubmission = z.infer<typeof insertImprovementSubmissionSchema>;
export type InsertImprovementComment = z.infer<typeof insertImprovementCommentSchema>;
export type InsertAndonIssue = z.infer<typeof insertAndonIssueSchema>;
