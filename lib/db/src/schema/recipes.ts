import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const recipeIngredientsTable = pgTable("recipe_ingredients", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 10, scale: 4 }).notNull(),
});

export const recipeSubRecipesTable = pgTable("recipe_sub_recipes", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  subRecipeId: integer("sub_recipe_id").notNull().references(() => subRecipesTable.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 10, scale: 4 }).notNull(),
});

export const insertRecipeSchema = createInsertSchema(recipesTable).omit({ id: true, createdAt: true });
export const insertRecipeIngredientSchema = createInsertSchema(recipeIngredientsTable).omit({ id: true });
export const insertRecipeSubRecipeSchema = createInsertSchema(recipeSubRecipesTable).omit({ id: true });
export type InsertRecipe = z.infer<typeof insertRecipeSchema>;
export type Recipe = typeof recipesTable.$inferSelect;
export type RecipeIngredient = typeof recipeIngredientsTable.$inferSelect;
export type RecipeSubRecipe = typeof recipeSubRecipesTable.$inferSelect;
