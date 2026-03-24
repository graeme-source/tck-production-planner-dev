import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
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

export type StorageLocation = typeof STORAGE_LOCATIONS[number];

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
});

export const insertStockEntrySchema = createInsertSchema(stockEntriesTable).omit({ id: true });
export type InsertStockEntry = z.infer<typeof insertStockEntrySchema>;
export type StockEntry = typeof stockEntriesTable.$inferSelect;
