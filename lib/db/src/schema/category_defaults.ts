import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const categoryDefaultsTable = pgTable("category_defaults", {
  id: serial("id").primaryKey(),
  category: text("category").notNull().unique(),
  defaultPackagingCost: numeric("default_packaging_cost", { precision: 10, scale: 4 }).notNull().default("0"),
  defaultLabourCost: numeric("default_labour_cost", { precision: 10, scale: 4 }).notNull().default("0"),
  defaultPackSize: integer("default_pack_size").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCategoryDefaultSchema = createInsertSchema(categoryDefaultsTable).omit({ id: true, createdAt: true });
export type InsertCategoryDefault = z.infer<typeof insertCategoryDefaultSchema>;
export type CategoryDefault = typeof categoryDefaultsTable.$inferSelect;
