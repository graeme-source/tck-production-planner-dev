import { pgTable, serial, text, numeric, integer, timestamp, date, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { recipesTable } from "./recipes";
import { usersTable } from "./users";

export const productionPlansTable = pgTable("production_plans", {
  id: serial("id").primaryKey(),
  planDate: date("plan_date").notNull(),
  name: text("name").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("draft"),
  batchNumber: integer("batch_number"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const productionPlanItemsTable = pgTable("production_plan_items", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "restrict" }),
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
  orderPosition: integer("order_position").notNull().default(0),
  batchesTarget: integer("batches_target").notNull().default(0),
  batchesComplete: integer("batches_complete").notNull().default(0),
  wonlyCount: integer("wonly_count").notNull().default(0),
  tinSize: text("tin_size"),
  maxBatchesPerTin: integer("max_batches_per_tin"),
  sopUrl: text("sop_url"),
});

export const batchCompletionsTable = pgTable("batch_completions", {
  id: serial("id").primaryKey(),
  planItemId: integer("plan_item_id").notNull().references(() => productionPlanItemsTable.id, { onDelete: "cascade" }),
  stationType: text("station_type").notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
});

export const stationBreaksTable = pgTable("station_breaks", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  stationType: text("station_type").notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  breakType: text("break_type").notNull().default("morning"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
});

export const dptSettingsTable = pgTable("dpt_settings", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().unique().references(() => recipesTable.id, { onDelete: "cascade" }),
  defaultBatchesPerDay: numeric("default_batches_per_day", { precision: 10, scale: 2 }).notNull().default("0"),
  surplusPercent: numeric("surplus_percent", { precision: 5, scale: 2 }).notNull().default("20"),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const timingStandardsTable = pgTable("timing_standards", {
  id: serial("id").primaryKey(),
  stationType: text("station_type").notNull().unique(),
  stationLabel: text("station_label").notNull(),
  minBatchesPerHour: numeric("min_batches_per_hour", { precision: 10, scale: 2 }).notNull().default("0"),
  targetBatchesPerHour: numeric("target_batches_per_hour", { precision: 10, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const appSettingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AppSetting = typeof appSettingsTable.$inferSelect;

export const insertProductionPlanSchema = createInsertSchema(productionPlansTable).omit({ id: true, createdAt: true });
export const insertProductionPlanItemSchema = createInsertSchema(productionPlanItemsTable).omit({ id: true });
export const insertBatchCompletionSchema = createInsertSchema(batchCompletionsTable).omit({ id: true });
export const insertStationBreakSchema = createInsertSchema(stationBreaksTable).omit({ id: true });
export const insertDptSettingSchema = createInsertSchema(dptSettingsTable).omit({ id: true, updatedAt: true });
export const insertTimingStandardSchema = createInsertSchema(timingStandardsTable).omit({ id: true, updatedAt: true });

export type InsertProductionPlan = z.infer<typeof insertProductionPlanSchema>;
export type ProductionPlan = typeof productionPlansTable.$inferSelect;
export type ProductionPlanItem = typeof productionPlanItemsTable.$inferSelect;
export type BatchCompletion = typeof batchCompletionsTable.$inferSelect;
export type StationBreak = typeof stationBreaksTable.$inferSelect;
export type DptSetting = typeof dptSettingsTable.$inferSelect;
export type TimingStandard = typeof timingStandardsTable.$inferSelect;
