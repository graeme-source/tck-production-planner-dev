import { pgTable, serial, text, integer, timestamp, date, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";

// Custom Drizzle type for Postgres `bytea` — stored / returned as Buffer.
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

// ─── Documents repository ───────────────────────────────────────────────────
// Originally created as risk_assessments. Now stores any compliance-tracked
// document: risk assessments (fire/food/general), insurance policies,
// certifications, licences, SOPs, etc. The table name is preserved for
// backwards compatibility but the user-facing label is "Documents".
//
// Metadata fields (review frequency, last reviewed, next review due) drive the
// compliance dashboard. Files are stored inline as bytea — PDFs only, ~200KB–
// 1MB typical, 15MB cap enforced at the upload route.
export const riskAssessmentsTable = pgTable("risk_assessments", {
  id: serial("id").primaryKey(),
  // Free-text category. Known values: fire | food_safety | general_safety |
  // insurance | certification | licence | sop | other.
  assessmentType: text("assessment_type").notNull(),
  title: text("title").notNull(),
  bodyMarkdown: text("body_markdown").notNull().default(""),
  // "draft" | "active" | "archived"
  status: text("status").notNull().default("draft"),
  reviewFrequencyMonths: integer("review_frequency_months").notNull().default(12),
  lastReviewedAt: timestamp("last_reviewed_at"),
  nextReviewDue: date("next_review_due"),
  lastReviewedByUserId: integer("last_reviewed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  lastReviewedByName: text("last_reviewed_by_name"),
  reviewerQualifications: text("reviewer_qualifications"),
  // File storage — NULL when no file attached (e.g. body is markdown-only).
  fileBlob: bytea("file_blob"),
  fileMime: text("file_mime"),
  fileName: text("file_name"),
  fileSizeBytes: integer("file_size_bytes"),
  fileVersion: text("file_version"),
  fileUploadedAt: timestamp("file_uploaded_at"),
  originalIssueDate: date("original_issue_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Compliance actions (the unified to-do list) ────────────────────────────
// A task — either one-off or recurring — linked (optionally) to a risk
// assessment. Marking complete writes to complianceActionCompletionsTable and,
// if recurring, auto-creates the next instance. The unified dashboard reads
// from this table filtered by due date + status.
export const complianceActionsTable = pgTable("compliance_actions", {
  id: serial("id").primaryKey(),
  riskAssessmentId: integer("risk_assessment_id").references(() => riskAssessmentsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  // Category for filtering in the dashboard: "fire" | "food_safety" | "general" | "electrical" | "gas" | "training" | "other"
  category: text("category").notNull().default("other"),
  // "low" | "medium" | "high" | "critical"
  priority: text("priority").notNull().default("medium"),
  // "open" | "in_progress" | "completed" | "not_applicable"
  status: text("status").notNull().default("open"),
  assignedToUserId: integer("assigned_to_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  assignedToName: text("assigned_to_name"),
  dueDate: date("due_date"),
  // "none" | "weekly" | "monthly" | "quarterly" | "six_monthly" | "annually" | "three_yearly" | "five_yearly"
  recurrence: text("recurrence").notNull().default("none"),
  // If this action was auto-created as a recurrence, points back to the original
  // "template" action. Used to keep a single logical chain for history views.
  parentActionId: integer("parent_action_id"),
  completedAt: timestamp("completed_at"),
  completedByUserId: integer("completed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  completedByName: text("completed_by_name"),
  completionNotes: text("completion_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Completion log (acts as the digital fire log book) ─────────────────────
// One row per completion event. Recurring actions can have many rows here
// (through their recurrence chain, joined via parentActionId on the action).
// This is the table the "EHO / SALSA audit log" report reads from.
export const complianceActionCompletionsTable = pgTable("compliance_action_completions", {
  id: serial("id").primaryKey(),
  actionId: integer("action_id").notNull().references(() => complianceActionsTable.id, { onDelete: "cascade" }),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
  completedByUserId: integer("completed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  completedByName: text("completed_by_name").notNull(),
  notes: text("notes"),
  // For recurring items, the id of the next-scheduled action created by this completion
  nextActionId: integer("next_action_id"),
});

export type RiskAssessment = typeof riskAssessmentsTable.$inferSelect;
export type ComplianceAction = typeof complianceActionsTable.$inferSelect;
export type ComplianceActionCompletion = typeof complianceActionCompletionsTable.$inferSelect;

export const insertRiskAssessmentSchema = createInsertSchema(riskAssessmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertComplianceActionSchema = createInsertSchema(complianceActionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertComplianceActionCompletionSchema = createInsertSchema(complianceActionCompletionsTable).omit({ id: true });
