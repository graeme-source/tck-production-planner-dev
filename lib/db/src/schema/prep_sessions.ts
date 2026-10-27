import { pgTable, serial, text, numeric, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { productionPlansTable, prepCompletionsTable } from "./production_plans";
import { ingredientsTable } from "./ingredients";
import { subRecipesTable } from "./sub_recipes";
import { recipesTable } from "./recipes";
import { usersTable } from "./users";

// Prep sessions — how long prep really takes (migration 0312; Objectives C
// and I). One row per person working one prep item, written invisibly by
// the prep screens (routes/prep-sessions.ts) and read by Analytics → Prep
// times. The migration file holds the CHECK (exactly one of ingredient_id /
// sub_recipe_id) and the indexes, and documents every column.

/** A gap in a session: it was closed, then re-opened within the continue
 *  window and carried on. Epoch milliseconds. Not prep time. */
export interface PrepSessionPause { from: number; to: number }

export const prepSessionsTable = pgTable("prep_sessions", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  station: text("station").notNull(),
  ingredientId: integer("ingredient_id").references(() => ingredientsTable.id, { onDelete: "cascade" }),
  subRecipeId: integer("sub_recipe_id").references(() => subRecipesTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id").references(() => recipesTable.id, { onDelete: "set null" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  deviceId: text("device_id"),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  completedAt: timestamp("completed_at"),
  quantity: numeric("quantity", { precision: 14, scale: 4 }),
  quantityUnit: text("quantity_unit"),
  pauses: jsonb("pauses").$type<PrepSessionPause[]>().notNull().default([]),
});

// What completed a session: a prep tick (linked to its prep_completions row,
// gone with it when the tick is undone) or a finished make-flow (no link).
export const prepSessionCompletionsTable = pgTable("prep_session_completions", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => prepSessionsTable.id, { onDelete: "cascade" }),
  prepCompletionId: integer("prep_completion_id").unique().references(() => prepCompletionsTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id").references(() => recipesTable.id, { onDelete: "set null" }),
  quantity: numeric("quantity", { precision: 14, scale: 4 }),
  quantityUnit: text("quantity_unit"),
  batches: numeric("batches", { precision: 10, scale: 3 }),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
});

export type PrepSession = typeof prepSessionsTable.$inferSelect;
export type PrepSessionCompletion = typeof prepSessionCompletionsTable.$inferSelect;
