import { pgTable, serial, text, numeric, integer, timestamp, date, boolean, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { recipesTable } from "./recipes";
import { usersTable } from "./users";
import { ingredientsTable } from "./ingredients";

export const productionPlansTable = pgTable("production_plans", {
  id: serial("id").primaryKey(),
  planDate: date("plan_date").notNull(),
  // The day general prep is scheduled for. Defaults to the previous
  // business day at insert time; can be overridden in the create-plan
  // dialog so prep slips to e.g. a Saturday for a Monday production.
  prepDate: date("prep_date"),
  // The day dough prep is scheduled for. Same defaulting rule as
  // prepDate. Kept separate from prepDate because dough is sometimes
  // done a different day to general prep (e.g. dough on Saturday,
  // other prep on Friday for a Monday production).
  doughDate: date("dough_date"),
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
  // Cumulative wonky count for display. wonlyCount is reset to 0 when wonkies
  // are transferred to the freezer (manual or auto-on-completion); wonlyTotal
  // is not, so the wrapping station can keep showing how many wonkies were
  // recorded for a recipe today.
  wonlyTotal: integer("wonly_total").notNull().default(0),
  wrappingComplete: boolean("wrapping_complete").notNull().default(false),
  fridgeQty: integer("fridge_qty").notNull().default(0),
  freezerQty: integer("freezer_qty").notNull().default(0),
  prepFridgeQty: integer("prep_fridge_qty").notNull().default(0),
  tinSize: text("tin_size"),
  maxBatchesPerTin: integer("max_batches_per_tin"),
  sopUrl: text("sop_url"),
  extraPacksBuilt: integer("extra_packs_built").notNull().default(0),
  shortCount: integer("short_count").notNull().default(0),
  eightPackBagCount: integer("eight_pack_bag_count").notNull().default(0),
  fridgeEightPackQty: integer("fridge_eight_pack_qty").notNull().default(0),
  mixingTinOverride: integer("mixing_tin_override"),
  leftoverFillingGrams: integer("leftover_filling_grams"),
  leftoverFillingComment: text("leftover_filling_comment"),
  // Set when the builder explicitly marks a recipe complete before hitting
  // batchesTarget (e.g. ran out of filling). Downstream stations treat the
  // builder's current batch count as the new effective target and pack
  // output is `batchesComplete × packsPerBatch + extraPacksBuilt`.
  builderMarkedCompleteAt: timestamp("builder_marked_complete_at"),
});

export const batchCompletionsTable = pgTable("batch_completions", {
  id: serial("id").primaryKey(),
  planItemId: integer("plan_item_id").notNull().references(() => productionPlanItemsTable.id, { onDelete: "cascade" }),
  stationType: text("station_type").notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
  // When the builder finished a batch short (e.g. ran out of filling for the
  // very last batch), this records the actual pack count produced by THIS
  // batch slot. Null = full batch contributing packsPerBatch packs.
  partialPacks: integer("partial_packs"),
  // Set when an admin retroactively logs a batch on an already-closed recipe
  // to rectify a miscount on the floor. The accompanying audit row goes here
  // so we can tell genuine production from corrections.
  correctionByUserId: integer("correction_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  correctionNote: text("correction_note"),
});

// Live presence ping per (planItem, station). The building station upserts
// while a builder is actively working on a recipe; the recipe-close action
// reads this to reject a close when another builder is mid-batch.
export const builderPresenceTable = pgTable("builder_presence", {
  id: serial("id").primaryKey(),
  planItemId: integer("plan_item_id").notNull().references(() => productionPlanItemsTable.id, { onDelete: "cascade" }),
  stationType: text("station_type").notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_builder_presence").on(table.planItemId, table.stationType),
]);

export const stationChangeoversTable = pgTable("station_changeovers", {
  id: serial("id").primaryKey(),
  planItemId: integer("plan_item_id").notNull().references(() => productionPlanItemsTable.id, { onDelete: "cascade" }),
  stationType: text("station_type").notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
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
  packsSold: integer("packs_sold").notNull().default(0),
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
export const insertStationChangeoverSchema = createInsertSchema(stationChangeoversTable).omit({ id: true });
export const insertStationBreakSchema = createInsertSchema(stationBreaksTable).omit({ id: true });
export const insertDptSettingSchema = createInsertSchema(dptSettingsTable).omit({ id: true, updatedAt: true });
export const insertTimingStandardSchema = createInsertSchema(timingStandardsTable).omit({ id: true, updatedAt: true });

export const prepCompletionsTable = pgTable("prep_completions", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  tinNumber: integer("tin_number").notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_prep_completion_v3").on(table.planId, table.ingredientId, table.recipeId, table.tinNumber),
]);

export const dailyStockChecksTable = pgTable("daily_stock_checks", {
  id: serial("id").primaryKey(),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "cascade" }),
  checkDate: date("check_date").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 4 }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_stock_check_ingredient_date").on(table.ingredientId, table.checkDate),
]);

export const temperatureRecordsTable = pgTable("temperature_records", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  planName: text("plan_name"),
  recipeId: integer("recipe_id"),
  recipeName: text("recipe_name"),
  ingredientId: integer("ingredient_id"),
  ingredientName: text("ingredient_name"),
  trayIndex: integer("tray_index").notNull(),
  temperatureC: numeric("temperature_c", { precision: 5, scale: 1 }).notNull(),
  recordType: text("record_type").notNull().default("cooked_core"),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name"),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});

export const ovenEventsTable = pgTable("oven_events", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id"),
  recipeName: text("recipe_name"),
  ingredientId: integer("ingredient_id"),
  ingredientName: text("ingredient_name"),
  trayIndex: integer("tray_index").notNull(),
  ovenInAt: timestamp("oven_in_at").notNull().defaultNow(),
  ovenOutAt: timestamp("oven_out_at"),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name"),
});

// Oven-station batch weight log — used for HACCP (chill start/end for the
// last batch of each recipe) and for weight-variance analysis. Written every
// time the oven operator logs a pack weight. The final batch for a recipe
// is flagged with `is_last_batch_of_recipe = true`; its `recorded_at` is the
// chill-start timestamp. `chill_end_at` is set by the Mark as Chilled button
// (oven or wrapping station) or as a fallback by the wrapping-complete action.
export const batchWeightRecordsTable = pgTable("batch_weight_records", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  planItemId: integer("plan_item_id").notNull().references(() => productionPlanItemsTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  batchSequence: integer("batch_sequence").notNull(),
  trayWeightG: numeric("tray_weight_g", { precision: 7, scale: 2 }).notNull(),
  portionWeightG: numeric("portion_weight_g", { precision: 7, scale: 2 }).notNull(),
  packSize: integer("pack_size").notNull(),
  targetWeightG: numeric("target_weight_g", { precision: 7, scale: 2 }).notNull(),
  actualWeightG: numeric("actual_weight_g", { precision: 7, scale: 2 }).notNull(),
  varianceG: numeric("variance_g", { precision: 7, scale: 2 }).notNull(),
  toleranceUnderG: numeric("tolerance_under_g", { precision: 7, scale: 2 }).notNull().default("0"),
  toleranceOverG: numeric("tolerance_over_g", { precision: 7, scale: 2 }).notNull().default("0"),
  withinTolerance: boolean("within_tolerance").notNull(),
  isLastBatchOfRecipe: boolean("is_last_batch_of_recipe").notNull().default(false),
  chillEndAt: timestamp("chill_end_at"),
  chilledByUserId: integer("chilled_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  chilledVia: text("chilled_via"), // 'oven_station' | 'wrapping_station' | 'wrapping_complete_auto'
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});

export type BatchWeightRecord = typeof batchWeightRecordsTable.$inferSelect;

// One row per (plan, recipe) capturing both the FIRST and LAST pack
// batch numbers shipped that day, for traceability. Both columns are
// nullable — opening check fills `first_*`, closing check fills `last_*`.
// Legacy columns (`batch_number`, `user_id`, `recorded_at`) are kept on
// the DB side during the migration window but are no longer read by the
// app.
export const packingBatchRecordsTable = pgTable("packing_batch_records", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  firstBatchNumber: integer("first_batch_number"),
  lastBatchNumber: integer("last_batch_number"),
  firstUserId: integer("first_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  lastUserId: integer("last_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  firstRecordedAt: timestamp("first_recorded_at"),
  lastRecordedAt: timestamp("last_recorded_at"),
}, (table) => [
  unique("uq_packing_batch_record").on(table.planId, table.recipeId),
]);

export type PackingBatchRecord = typeof packingBatchRecordsTable.$inferSelect;

export const prepTinOverridesTable = pgTable("prep_tin_overrides", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").references(() => ingredientsTable.id, { onDelete: "cascade" }),
  tinCount: integer("tin_count").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_prep_tin_override").on(table.planId, table.recipeId, table.ingredientId),
]);

export type PrepTinOverride = typeof prepTinOverridesTable.$inferSelect;

export const insertPrepCompletionSchema = createInsertSchema(prepCompletionsTable).omit({ id: true });
export const insertDailyStockCheckSchema = createInsertSchema(dailyStockChecksTable).omit({ id: true, checkedAt: true });
export type TemperatureRecord = typeof temperatureRecordsTable.$inferSelect;
export type OvenEvent = typeof ovenEventsTable.$inferSelect;

export type InsertProductionPlan = z.infer<typeof insertProductionPlanSchema>;
export type ProductionPlan = typeof productionPlansTable.$inferSelect;
export type ProductionPlanItem = typeof productionPlanItemsTable.$inferSelect;
export type BatchCompletion = typeof batchCompletionsTable.$inferSelect;
export type BuilderPresence = typeof builderPresenceTable.$inferSelect;
export type StationChangeover = typeof stationChangeoversTable.$inferSelect;
export type StationBreak = typeof stationBreaksTable.$inferSelect;
export type DptSetting = typeof dptSettingsTable.$inferSelect;
export type TimingStandard = typeof timingStandardsTable.$inferSelect;
export type PrepCompletion = typeof prepCompletionsTable.$inferSelect;
export type DailyStockCheck = typeof dailyStockChecksTable.$inferSelect;
