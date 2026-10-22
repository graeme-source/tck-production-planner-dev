import { pgTable, serial, text, integer, timestamp, boolean, unique, date, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { productionPlansTable } from "./production_plans";
import { usersTable } from "./users";

export const checklistTemplatesTable = pgTable("checklist_templates", {
  id: serial("id").primaryKey(),
  stationType: text("station_type").notNull(),
  category: text("category").notNull(), // "opening" | "cleaning" | "closing"
  title: text("title").notNull(),
  description: text("description"),
  schedule: text("schedule").notNull().default("daily"), // "daily" | "weekly" | "specific_days" | "periodic"
  scheduleDays: text("schedule_days"), // JSON array e.g. '["monday","wednesday"]'
  // For "periodic" (every 4 weeks — TCK runs 13 four-week periods a year):
  // the anchor date whose WEEK defines the cycle. The task is due on its
  // scheduleDays in every week that is a multiple of 4 weeks from the
  // anchor's week. Null falls back to the template's creation date.
  scheduleAnchorDate: date("schedule_anchor_date"),
  orderPosition: integer("order_position").notNull().default(0),
  dynamicDataType: text("dynamic_data_type"), // null | "temperature_records" | "oven_events"
  // "Record a reading" (migration 0227, issues #87/#169). NULL unit = a plain
  // tick. Labels = one reading each (e.g. Scale 1, Scale 2); empty = one.
  // Min/max = optional pass range, NULL = no limit that side.
  readingUnit: text("reading_unit"),
  readingLabels: text("reading_labels").array(),
  readingMin: numeric("reading_min", { precision: 10, scale: 2 }),
  readingMax: numeric("reading_max", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const checklistCompletionsTable = pgTable("checklist_completions", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => checklistTemplatesTable.id, { onDelete: "cascade" }),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  stationType: text("station_type").notNull(),
  completedBy: integer("completed_by").references(() => usersTable.id, { onDelete: "set null" }),
  completedByName: text("completed_by_name").notNull(),
  notes: text("notes"),
  skippedReason: text("skipped_reason"),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
}, (t) => [
  unique("uq_checklist_completion").on(t.templateId, t.planId),
]);

export const checklistOneoffItemsTable = pgTable("checklist_oneoff_items", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  stationType: text("station_type").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  orderPosition: integer("order_position").notNull().default(0),
  completedBy: integer("completed_by").references(() => usersTable.id, { onDelete: "set null" }),
  completedByName: text("completed_by_name"),
  skippedReason: text("skipped_reason"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// One reading per (item, plan, label) — migration 0227. The pass range in
// force is copied on so later edits to the item never rewrite a verdict.
export const checklistReadingsTable = pgTable("checklist_readings", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => checklistTemplatesTable.id, { onDelete: "cascade" }),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  stationType: text("station_type").notNull(),
  label: text("label").notNull().default(""),
  value: numeric("value", { precision: 10, scale: 2 }).notNull(),
  unit: text("unit").notNull(),
  expectedMin: numeric("expected_min", { precision: 10, scale: 2 }),
  expectedMax: numeric("expected_max", { precision: 10, scale: 2 }),
  inRange: boolean("in_range"),
  recordedBy: integer("recorded_by").references(() => usersTable.id, { onDelete: "set null" }),
  recordedByName: text("recorded_by_name").notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
}, (t) => [
  unique("uq_checklist_reading").on(t.templateId, t.planId, t.label),
  index("checklist_readings_recorded_at_idx").on(t.recordedAt),
]);

export const insertChecklistTemplateSchema = createInsertSchema(checklistTemplatesTable);
export const insertChecklistCompletionSchema = createInsertSchema(checklistCompletionsTable);
export const insertChecklistOneoffSchema = createInsertSchema(checklistOneoffItemsTable);
