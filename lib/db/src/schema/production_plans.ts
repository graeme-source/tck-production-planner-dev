import { pgTable, serial, text, numeric, integer, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { recipesTable } from "./recipes";

export const productionPlansTable = pgTable("production_plans", {
  id: serial("id").primaryKey(),
  planDate: date("plan_date").notNull(),
  name: text("name").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const productionPlanItemsTable = pgTable("production_plan_items", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "restrict" }),
  targetQuantity: numeric("target_quantity", { precision: 10, scale: 4 }).notNull(),
  actualQuantity: numeric("actual_quantity", { precision: 10, scale: 4 }),
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
});

export const insertProductionPlanSchema = createInsertSchema(productionPlansTable).omit({ id: true, createdAt: true });
export const insertProductionPlanItemSchema = createInsertSchema(productionPlanItemsTable).omit({ id: true });
export type InsertProductionPlan = z.infer<typeof insertProductionPlanSchema>;
export type ProductionPlan = typeof productionPlansTable.$inferSelect;
export type ProductionPlanItem = typeof productionPlanItemsTable.$inferSelect;
