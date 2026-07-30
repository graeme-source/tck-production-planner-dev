/**
 * Case orders — bulk frozen 8-pack-bag orders (e.g. Waterdean), produced across
 * several days on top of normal 2-pack production and handed over on a
 * collection.
 *
 * Vocabulary, fixed by the 2026-07 Waterdean order:
 *   portion  — one calzone
 *   bag      — an 8-pack bag: 8 portions, bagged AFTER the blast chiller and
 *              destined for the walk-in product freezer (NOT normal fridge
 *              8-pack stock — different classification, frozen for the customer)
 *   case     — a box of bags. Composition varies: "Margherita case" = 3 bags of
 *              margherita; "Mixed case" = 1 bag each of three recipes. Case
 *              types are DATA (rows), not code, so a "Godfather case" is data
 *              entry, not a build.
 *   batch    — 10 portions, the production unit. bags×8/10 = batch-equivalents.
 *
 * Required bags per recipe are derived from the arithmetic (cases × bags-per-
 * case), never hand-counted — hand-counting 2,400 portions is the failure this
 * feature exists to end.
 *
 * Progress is a ledger (case_order_production): one row per freezer-bag count
 * event from the wrapping station, so "made vs still to make" is a SUM, and a
 * mistaken count is corrected by a compensating row rather than mutated away.
 */
import { pgTable, serial, text, integer, boolean, timestamp, date, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";
import { suppliersTable } from "./suppliers";
import { recipesTable } from "./recipes";
import { productionPlansTable } from "./production_plans";

/** A sellable case configuration, e.g. "Margherita case (3 bags)". */
export const caseTypesTable = pgTable("case_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const caseTypeLinesTable = pgTable("case_type_lines", {
  id: serial("id").primaryKey(),
  caseTypeId: integer("case_type_id").notNull().references(() => caseTypesTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "restrict" }),
  bagsPerCase: integer("bags_per_case").notNull().default(1),
}, (t) => ({
  caseTypeIdx: index("ix_case_type_lines_type").on(t.caseTypeId),
}));

export const caseOrdersTable = pgTable("case_orders", {
  id: serial("id").primaryKey(),
  // The customer is a supplier record (Waterdean already is one) so the order
  // can finish on a collection, which is keyed to suppliers.
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
  reference: text("reference"),
  // Production must be complete and frozen BEFORE this date; the scheduler
  // spreads bags across the days up to (not including) it.
  targetCollectionDate: date("target_collection_date").notNull(),
  // "open" | "complete" | "cancelled"
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
}, (t) => ({
  targetIdx: index("ix_case_orders_target").on(t.targetCollectionDate),
}));

export const caseOrderLinesTable = pgTable("case_order_lines", {
  id: serial("id").primaryKey(),
  caseOrderId: integer("case_order_id").notNull().references(() => caseOrdersTable.id, { onDelete: "cascade" }),
  caseTypeId: integer("case_type_id").notNull().references(() => caseTypesTable.id, { onDelete: "restrict" }),
  casesOrdered: integer("cases_ordered").notNull(),
}, (t) => ({
  orderIdx: index("ix_case_order_lines_order").on(t.caseOrderId),
}));

/** Append-only ledger of freezer bags counted in, written by the wrapping
 *  station. Negative bags = a correction. */
export const caseOrderProductionTable = pgTable("case_order_production", {
  id: serial("id").primaryKey(),
  caseOrderId: integer("case_order_id").notNull().references(() => caseOrdersTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "restrict" }),
  planId: integer("plan_id").references(() => productionPlansTable.id, { onDelete: "set null" }),
  productionDate: date("production_date").notNull(),
  bags: integer("bags").notNull(),
  countedByUserId: integer("counted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  countedByName: text("counted_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  orderRecipeIdx: index("ix_case_order_production_order").on(t.caseOrderId, t.recipeId),
}));

export type CaseType = typeof caseTypesTable.$inferSelect;
export type CaseTypeLine = typeof caseTypeLinesTable.$inferSelect;
export type CaseOrder = typeof caseOrdersTable.$inferSelect;
export type CaseOrderLine = typeof caseOrderLinesTable.$inferSelect;
export type CaseOrderProduction = typeof caseOrderProductionTable.$inferSelect;

export const insertCaseTypeSchema = createInsertSchema(caseTypesTable).omit({ id: true, createdAt: true });
export const insertCaseOrderSchema = createInsertSchema(caseOrdersTable).omit({ id: true, createdAt: true });
