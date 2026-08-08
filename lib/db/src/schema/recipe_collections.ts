// Recipe collections — named groups of recipes for one-click adding to a
// production plan (e.g. "August Test Box" = its three test calzones).
//
// Not to be confused with `collections` (goods leaving the unit, the mirror
// of a delivery) — these are purely a planning convenience.
//
// Membership is a plain join table; deleting a recipe or a collection
// cascades its rows away. Order within a collection is by position so the
// picker shows recipes the way the operator saved them.

import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { recipesTable } from "./recipes";

export const recipeCollectionsTable = pgTable("recipe_collections", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const recipeCollectionItemsTable = pgTable("recipe_collection_items", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").notNull().references(() => recipeCollectionsTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
}, (t) => ({
  collectionIdx: index("ix_recipe_collection_items_collection").on(t.collectionId),
}));

export type RecipeCollection = typeof recipeCollectionsTable.$inferSelect;
export type RecipeCollectionItem = typeof recipeCollectionItemsTable.$inferSelect;

export const insertRecipeCollectionSchema = createInsertSchema(recipeCollectionsTable).omit({ id: true, createdAt: true });
export const insertRecipeCollectionItemSchema = createInsertSchema(recipeCollectionItemsTable).omit({ id: true });
