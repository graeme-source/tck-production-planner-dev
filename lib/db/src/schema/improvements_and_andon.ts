import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
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
  reportContext: text("report_context"),
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
