import { pgTable, serial, text, integer, timestamp, boolean, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { productionPlansTable } from "./production_plans";
import { usersTable } from "./users";

export const checklistTemplatesTable = pgTable("checklist_templates", {
  id: serial("id").primaryKey(),
  stationType: text("station_type").notNull(),
  category: text("category").notNull(), // "opening" | "cleaning" | "closing"
  title: text("title").notNull(),
  description: text("description"),
  schedule: text("schedule").notNull().default("daily"), // "daily" | "weekly" | "specific_days"
  scheduleDays: text("schedule_days"), // JSON array e.g. '["monday","wednesday"]'
  orderPosition: integer("order_position").notNull().default(0),
  dynamicDataType: text("dynamic_data_type"), // null | "temperature_records" | "oven_events"
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
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertChecklistTemplateSchema = createInsertSchema(checklistTemplatesTable);
export const insertChecklistCompletionSchema = createInsertSchema(checklistCompletionsTable);
export const insertChecklistOneoffSchema = createInsertSchema(checklistOneoffItemsTable);
