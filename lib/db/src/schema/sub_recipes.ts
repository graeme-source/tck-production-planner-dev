import { pgTable, serial, text, numeric, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ingredientsTable } from "./ingredients";

export const subRecipesTable = pgTable("sub_recipes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  yield: numeric("yield", { precision: 10, scale: 4 }).notNull(),
  yieldUnit: text("yield_unit").notNull(),
  notes: text("notes"),
  shelfLifeDays: integer("shelf_life_days"),
  isBase: boolean("is_base").notNull().default(false),
  labelDeclaration: text("label_declaration"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const subRecipeIngredientsTable = pgTable("sub_recipe_ingredients", {
  id: serial("id").primaryKey(),
  subRecipeId: integer("sub_recipe_id").notNull().references(() => subRecipesTable.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 10, scale: 4 }).notNull(),
});

export const subRecipeSubRecipesTable = pgTable("sub_recipe_sub_recipes", {
  id: serial("id").primaryKey(),
  subRecipeId: integer("sub_recipe_id").notNull().references(() => subRecipesTable.id, { onDelete: "cascade" }),
  componentSubRecipeId: integer("component_sub_recipe_id").notNull().references(() => subRecipesTable.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 10, scale: 4 }).notNull(),
});

export const insertSubRecipeSchema = createInsertSchema(subRecipesTable).omit({ id: true, createdAt: true });
export const insertSubRecipeIngredientSchema = createInsertSchema(subRecipeIngredientsTable).omit({ id: true });
export const insertSubRecipeSubRecipeSchema = createInsertSchema(subRecipeSubRecipesTable).omit({ id: true });
export type InsertSubRecipe = z.infer<typeof insertSubRecipeSchema>;
export type SubRecipe = typeof subRecipesTable.$inferSelect;
export type SubRecipeIngredient = typeof subRecipeIngredientsTable.$inferSelect;
export type SubRecipeSubRecipe = typeof subRecipeSubRecipesTable.$inferSelect;
