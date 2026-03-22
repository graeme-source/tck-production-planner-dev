import { pgTable, serial, text, numeric, integer, timestamp, check, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ingredientsTable } from "./ingredients";
import { subRecipesTable } from "./sub_recipes";

export const recipesTable = pgTable("recipes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  servings: numeric("servings", { precision: 10, scale: 4 }).notNull(),
  servingUnit: text("serving_unit").notNull(),
  category: text("category"),
  notes: text("notes"),
  packSize: numeric("pack_size", { precision: 10, scale: 4 }).notNull().default("1"),
  rrp: numeric("rrp", { precision: 10, scale: 4 }).notNull().default("0"),
  packagingCost: numeric("packaging_cost", { precision: 10, scale: 4 }).notNull().default("0"),
  labourCost: numeric("labour_cost", { precision: 10, scale: 4 }).notNull().default("0"),
  portionsPerBatch: integer("portions_per_batch").notNull().default(10),
  shelfLifeDays: integer("shelf_life_days"),
  tinSize: text("tin_size"),
  maxBatchesPerTin: integer("max_batches_per_tin"),
  sopUrl: text("sop_url"),
  fillWeightGrams: numeric("fill_weight_grams", { precision: 10, scale: 2 }),
  baseType: text("base_type"),
  baseWeightGrams: numeric("base_weight_grams", { precision: 10, scale: 2 }),
  isCoreMenu: boolean("is_core_menu").notNull().default(false),
  color: text("color"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const recipeIngredientsTable = pgTable("recipe_ingredients", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 10, scale: 4 }).notNull(),
  marinadeForIngredientId: integer("marinade_for_ingredient_id").references(() => ingredientsTable.id, { onDelete: "set null" }),
  includeInFillingMix: boolean("include_in_filling_mix").notNull().default(false),
});

export const recipeSubRecipesTable = pgTable("recipe_sub_recipes", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  subRecipeId: integer("sub_recipe_id").notNull().references(() => subRecipesTable.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 10, scale: 4 }).notNull(),
  marinadeForIngredientId: integer("marinade_for_ingredient_id").references(() => ingredientsTable.id, { onDelete: "set null" }),
  includeInFillingMix: boolean("include_in_filling_mix").notNull().default(false),
});

export const recipeMeatMarinadesTable = pgTable("recipe_meat_marinades", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  rawMeatIngredientId: integer("raw_meat_ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "restrict" }),
  marinadeIngredientId: integer("marinade_ingredient_id").references(() => ingredientsTable.id, { onDelete: "restrict" }),
  marinadeSubRecipeId: integer("marinade_sub_recipe_id").references(() => subRecipesTable.id, { onDelete: "restrict" }),
  gramsPerKg: numeric("grams_per_kg", { precision: 10, scale: 4 }).notNull(),
}, (table) => [
  check("marinade_xor", sql`(${table.marinadeIngredientId} IS NOT NULL AND ${table.marinadeSubRecipeId} IS NULL) OR (${table.marinadeIngredientId} IS NULL AND ${table.marinadeSubRecipeId} IS NOT NULL)`),
  check("grams_per_kg_positive", sql`${table.gramsPerKg} > 0`),
]);

export const insertRecipeSchema = createInsertSchema(recipesTable).omit({ id: true, createdAt: true });
export const insertRecipeIngredientSchema = createInsertSchema(recipeIngredientsTable).omit({ id: true });
export const insertRecipeSubRecipeSchema = createInsertSchema(recipeSubRecipesTable).omit({ id: true });
export const insertRecipeMeatMarinadeSchema = createInsertSchema(recipeMeatMarinadesTable).omit({ id: true });
export type InsertRecipe = z.infer<typeof insertRecipeSchema>;
export type Recipe = typeof recipesTable.$inferSelect;
export type RecipeIngredient = typeof recipeIngredientsTable.$inferSelect;
export type RecipeSubRecipe = typeof recipeSubRecipesTable.$inferSelect;
export type RecipeMeatMarinade = typeof recipeMeatMarinadesTable.$inferSelect;
