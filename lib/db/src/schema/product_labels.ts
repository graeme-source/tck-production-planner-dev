import { pgTable, serial, integer, text, timestamp, boolean, jsonb, unique, index, date } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { recipesTable } from "./recipes";

// Product labels, Stage 1 (migration 0158). The label design, per-recipe
// label settings, and the published ("live") versions with their frozen
// snapshots. Logic lives in @workspace/product-labels.

export const productLabelTemplatesTable = pgTable("product_label_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // LabelTemplate JSON (lib/product-labels template.ts), normalised on read.
  settings: jsonb("settings").notNull().default({}),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const productLabelSettingsTable = pgTable("product_label_settings", {
  recipeId: integer("recipe_id").primaryKey().references(() => recipesTable.id, { onDelete: "cascade" }),
  templateId: integer("template_id").references(() => productLabelTemplatesTable.id, { onDelete: "set null" }),
  barcode: text("barcode"),
  labelName: text("label_name"),
  ovenOn: boolean("oven_on").notNull().default(true),
  airFryerOn: boolean("air_fryer_on").notNull().default(true),
  // NULL = the template's default.
  ovenTempC: integer("oven_temp_c"),
  fanTempC: integer("fan_temp_c"),
  ovenMinMinutes: integer("oven_min_minutes"),
  ovenMaxMinutes: integer("oven_max_minutes"),
  airFryerTempC: integer("air_fryer_temp_c"),
  airFryerMinMinutes: integer("air_fryer_min_minutes"),
  airFryerMaxMinutes: integer("air_fryer_max_minutes"),
  warningOn: boolean("warning_on").notNull().default(true),
  // NULL = the recipe's shelf_life_days (chilled) / the template (frozen).
  chilledAmount: integer("chilled_amount"),
  chilledUnit: text("chilled_unit"),
  frozenOn: boolean("frozen_on").notNull().default(true),
  frozenAmount: integer("frozen_amount"),
  frozenUnit: text("frozen_unit"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedByName: text("updated_by_name"),
});

export const productLabelVersionsTable = pgTable("product_label_versions", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").references(() => recipesTable.id, { onDelete: "set null" }),
  recipeName: text("recipe_name").notNull(),
  versionNo: integer("version_no").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  fit: jsonb("fit").notNull(),
  templateId: integer("template_id"),
  templateVersion: integer("template_version"),
  publishedAt: timestamp("published_at").notNull().defaultNow(),
  publishedById: integer("published_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  publishedByName: text("published_by_name"),
}, t => [
  unique("product_label_versions_recipe_version").on(t.recipeId, t.versionNo),
  index("idx_product_label_versions_recipe").on(t.recipeId, t.versionNo),
]);

export type ProductLabelTemplate = typeof productLabelTemplatesTable.$inferSelect;
export type ProductLabelSettingsRow = typeof productLabelSettingsTable.$inferSelect;
export type ProductLabelVersion = typeof productLabelVersionsTable.$inferSelect;

// Back-label print runs (migration 0166) — traceability of every run.
export const productLabelPrintsTable = pgTable("product_label_prints", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").references(() => recipesTable.id, { onDelete: "set null" }),
  recipeName: text("recipe_name").notNull(),
  labelVersionId: integer("label_version_id").references(() => productLabelVersionsTable.id, { onDelete: "set null" }),
  versionNo: integer("version_no").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  count: integer("count").notNull(),
  printDate: date("print_date").notNull(),
  productionDate: date("production_date").notNull(),
  batchCode: text("batch_code").notNull(),
  chilledUseBy: date("chilled_use_by"),
  frozenUseBy: date("frozen_use_by"),
  planId: integer("plan_id"),
  planItemId: integer("plan_item_id"),
  format: text("format").notNull().default("pdf"),
  printedById: integer("printed_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  printedByName: text("printed_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ProductLabelPrint = typeof productLabelPrintsTable.$inferSelect;
