import { pgTable, serial, text, numeric, integer, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { recipesTable } from "./recipes";
import { ingredientsTable } from "./ingredients";
import { stockItemsTable } from "./stock_items";

export const STORAGE_LOCATIONS = [
  "production_fridge",
  "production_freezer",
  "prep_fridge",
  "dry_store",
  "raw_meat_fridge",
  "raw_freezer",
] as const;

export const FREEZER_LOCATIONS: readonly string[] = [
  "production_freezer",
  "raw_freezer",
] as const;

// Renamed from `StorageLocation` to avoid colliding with the row type of the
// newer `storage_locations` table (see ordering.ts). This is a string-literal
// union of legacy fixed location codes used by the original stock-control flow.
export type StorageLocationCode = typeof STORAGE_LOCATIONS[number];

export const stockEntriesTable = pgTable("stock_entries", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").references(() => recipesTable.id, { onDelete: "set null" }),
  ingredientId: integer("ingredient_id").references(() => ingredientsTable.id, { onDelete: "set null" }),
  stockItemId: integer("stock_item_id").references(() => stockItemsTable.id, { onDelete: "set null" }),
  itemType: text("item_type").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 4 }).notNull(),
  unit: text("unit").notNull(),
  location: text("location").notNull().default("production_fridge"),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
  notes: text("notes"),
  useByDate: date("use_by_date"),
  packSize: integer("pack_size").notNull().default(2),
});

export const insertStockEntrySchema = createInsertSchema(stockEntriesTable).omit({ id: true });
export type InsertStockEntry = z.infer<typeof insertStockEntrySchema>;
export type StockEntry = typeof stockEntriesTable.$inferSelect;

export const fridgeStockBatchesTable = pgTable("fridge_stock_batches", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  batchNumber: integer("batch_number").notNull(),
  packSize: integer("pack_size").notNull().default(2),
  quantity: integer("quantity").notNull().default(0),
  useByDate: date("use_by_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type FridgeStockBatch = typeof fridgeStockBatchesTable.$inferSelect;
