// Training matrix — colleague onboarding & training sign-off.
//
// A matrix is a grid: enrolled app users down the side, training items across
// the top, and a per-cell sign-off (trained yes/no + date + who signed off).
// An item is either a free-text checklist entry or linked to a live SOP in the
// Documents repository (risk_assessments where assessment_type = 'sop'), so the
// column can open the actual SOP PDF.

import { pgTable, serial, text, integer, boolean, timestamp, date, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";
import { riskAssessmentsTable } from "./risk_assessments";

// ─── Matrices ───────────────────────────────────────────────────────────────
export const trainingMatricesTable = pgTable("training_matrices", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Items (columns) ──────────────────────────────────────────────────────────
// sopId non-null = linked to a live SOP document. label is the column header
// (defaults to the SOP title for linked items, but stays editable).
export const trainingMatrixItemsTable = pgTable("training_matrix_items", {
  id: serial("id").primaryKey(),
  matrixId: integer("matrix_id").notNull().references(() => trainingMatricesTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  sopId: integer("sop_id").references(() => riskAssessmentsTable.id, { onDelete: "set null" }),
  // Lean matrix items certify a weekly lean principle: completing that
  // week's in-app lesson review auto-ticks this item (migration 0055).
  // Plain integer (no FK helper import) — the DB carries the constraint.
  principleId: integer("principle_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Enrolments (rows) ──────────────────────────────────────────────────────
// Which app users appear in a matrix. One row per (matrix, user).
export const trainingMatrixEnrolmentsTable = pgTable("training_matrix_enrolments", {
  id: serial("id").primaryKey(),
  matrixId: integer("matrix_id").notNull().references(() => trainingMatricesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_training_enrolment").on(table.matrixId, table.userId),
]);

// ─── Records (cells) ──────────────────────────────────────────────────────────
// One sign-off per (item, user), upserted whenever a cell is toggled.
export const trainingRecordsTable = pgTable("training_records", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => trainingMatrixItemsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  trained: boolean("trained").notNull().default(false),
  trainedAt: date("trained_at"),
  signedOffByUserId: integer("signed_off_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  signedOffByName: text("signed_off_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_training_record").on(table.itemId, table.userId),
]);

export type TrainingMatrix = typeof trainingMatricesTable.$inferSelect;
export type TrainingMatrixItem = typeof trainingMatrixItemsTable.$inferSelect;
export type TrainingMatrixEnrolment = typeof trainingMatrixEnrolmentsTable.$inferSelect;
export type TrainingRecord = typeof trainingRecordsTable.$inferSelect;

export const insertTrainingMatrixSchema = createInsertSchema(trainingMatricesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTrainingMatrixItemSchema = createInsertSchema(trainingMatrixItemsTable).omit({ id: true, createdAt: true });
export const insertTrainingRecordSchema = createInsertSchema(trainingRecordsTable).omit({ id: true, createdAt: true, updatedAt: true });
