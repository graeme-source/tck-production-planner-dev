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
  expandInPrep: boolean("expand_in_prep").notNull().default(false),
  // Dough that is mixed on the production day itself (cinnamon bun dough)
  // rather than the day before like calzone dough. The dough station shows
  // these on the plan's own day and keeps them out of the day-before view.
  madeOnProductionDay: boolean("made_on_production_day").notNull().default(false),
  // Manual yield percentage. NULL = automatic: `yield` is recomputed on every
  // save as 100% of the total component weight, so it can never drift from
  // the recipe (the Bun Dough yield went stale after milk was added and
  // silently inflated every scaled quantity by 1.5× — 2026-08-20). Set a
  // percentage only when the process genuinely loses weight (a reduced
  // sauce); `yield` then tracks total × yieldPercent / 100 instead.
  yieldPercent: numeric("yield_percent", { precision: 6, scale: 2 }),
  labelDeclaration: text("label_declaration"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const subRecipeIngredientsTable = pgTable("sub_recipe_ingredients", {
  id: serial("id").primaryKey(),
  subRecipeId: integer("sub_recipe_id").notNull().references(() => subRecipesTable.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 10, scale: 4 }).notNull(),
  // When true, this component is kept in the sub-recipe for ratio math
  // but hidden from the prep-station expansion. Used for things like the
  // "absorbed" water in a pasta sub-recipe: we need the quantity to scale
  // the other ingredients correctly, but the prep team shouldn't see it
  // as an item to weigh out.
  hideFromPrep: boolean("hide_from_prep").notNull().default(false),
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
