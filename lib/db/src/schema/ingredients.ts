import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { suppliersTable } from "./suppliers";

export const ingredientsTable = pgTable("ingredients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  packWeight: numeric("pack_weight", { precision: 10, scale: 4 }).notNull().default("0"),
  costPerPack: numeric("cost_per_pack", { precision: 10, scale: 4 }).notNull().default("0"),
  brand: text("brand"),
  supplierPartNumber: text("supplier_part_number"),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  secondarySupplierId: integer("secondary_supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  orderingUrl: text("ordering_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertIngredientSchema = createInsertSchema(ingredientsTable).omit({ id: true, createdAt: true });
export type InsertIngredient = z.infer<typeof insertIngredientSchema>;
export type Ingredient = typeof ingredientsTable.$inferSelect;
