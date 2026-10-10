/**
 * Automatic QUID (migration 0165, Graeme 2026-10-10). Objectives A and D.
 *
 * quid_terms — the words list the QUID matcher reads recipe names with
 * (artifacts/api-server/src/lib/quid-matcher.ts explains each mode). Data,
 * not code: Settings → "QUID words" edits it.
 *
 * recipe_quid_components — QUID on an ingredient INSIDE one of a recipe's
 * sub-recipe lines (the chicken in a pie filling): its percentage of the
 * whole product goes after it inside the compound's brackets. One row per
 * decision; a row with quid = false and source 'manual' is a person's "no".
 * The recipe lines' own QUID stays on recipe_ingredients / recipe_sub_recipes
 * (quid + quid_source).
 */
import { pgTable, serial, text, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { recipesTable } from "./recipes";
import { subRecipesTable } from "./sub_recipes";
import { ingredientsTable } from "./ingredients";

export const quidTermsTable = pgTable("quid_terms", {
  id: serial("id").primaryKey(),
  phrase: text("phrase").notNull(),
  /** 'auto' | 'suggest' | 'ignore' | 'guard' */
  mode: text("mode").notNull(),
  targets: text("targets").array().notNull().default(sql`'{}'::text[]`),
  categories: text("categories").array().notNull().default(sql`'{}'::text[]`),
  isCategory: boolean("is_category").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedByName: text("updated_by_name"),
}, (t) => [
  uniqueIndex("quid_terms_phrase_kind_uq").on(sql`lower(${t.phrase})`, sql`(${t.mode} = 'guard')`),
]);

export const recipeQuidComponentsTable = pgTable("recipe_quid_components", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  subRecipeId: integer("sub_recipe_id").notNull().references(() => subRecipesTable.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "cascade" }),
  quid: boolean("quid").notNull(),
  /** 'auto' | 'manual' */
  source: text("source").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedByName: text("updated_by_name"),
}, (t) => [
  uniqueIndex("recipe_quid_components_uq").on(t.recipeId, t.subRecipeId, t.ingredientId),
]);

export type QuidTermRow = typeof quidTermsTable.$inferSelect;
export type RecipeQuidComponentRow = typeof recipeQuidComponentsTable.$inferSelect;
