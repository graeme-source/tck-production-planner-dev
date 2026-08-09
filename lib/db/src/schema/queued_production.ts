// Queued test production — batches decided ahead of the plan existing.
//
// Test products (new recipes, unusual ingredients) need their orders placed
// days before the normal ordering cycle would ask for them. A queue row says
// "on this production date we will make N batches of this recipe"; the queue
// page resolves the ingredient requirements, splits routine stock (stock
// check or kanban bag) from special ingredients, and raises purchase orders
// for the special ones early. When the planner later creates the plan for
// that date, queued rows land on it automatically (status → planned).
//
// Status: queued → planned (landed on a plan) | cancelled. Deleting the plan
// resets its rows to queued so the batches can land again.

import { pgTable, serial, integer, date, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { recipesTable } from "./recipes";
import { productionPlansTable } from "./production_plans";
import { usersTable } from "./users";

export const queuedProductionTable = pgTable("queued_production", {
  id: serial("id").primaryKey(),
  productionDate: date("production_date").notNull(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  batches: integer("batches").notNull(),
  status: text("status").notNull().default("queued"),
  planId: integer("plan_id").references(() => productionPlansTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  dateIdx: index("ix_queued_production_date").on(t.productionDate),
}));

export type QueuedProduction = typeof queuedProductionTable.$inferSelect;
export const insertQueuedProductionSchema = createInsertSchema(queuedProductionTable).omit({ id: true, createdAt: true });
