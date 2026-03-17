import { pgTable, serial, text, numeric, integer, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { recipesTable } from "./recipes";

export const dispatchOrdersTable = pgTable("dispatch_orders", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "restrict" }),
  dispatchDate: date("dispatch_date").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 4 }).notNull(),
  customer: text("customer"),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDispatchOrderSchema = createInsertSchema(dispatchOrdersTable).omit({ id: true, createdAt: true });
export type InsertDispatchOrder = z.infer<typeof insertDispatchOrderSchema>;
export type DispatchOrder = typeof dispatchOrdersTable.$inferSelect;
