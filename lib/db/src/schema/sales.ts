import { pgTable, serial, text, numeric, integer, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { recipesTable } from "./recipes";

export const salesEntriesTable = pgTable("sales_entries", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "restrict" }),
  saleDate: date("sale_date").notNull(),
  quantitySold: numeric("quantity_sold", { precision: 10, scale: 4 }).notNull(),
  channel: text("channel"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSalesEntrySchema = createInsertSchema(salesEntriesTable).omit({ id: true, createdAt: true });
export type InsertSalesEntry = z.infer<typeof insertSalesEntrySchema>;
export type SalesEntry = typeof salesEntriesTable.$inferSelect;
