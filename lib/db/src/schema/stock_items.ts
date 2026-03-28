import { pgTable, serial, text, numeric, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { suppliersTable } from "./suppliers";

export const DEFAULT_STOCK_ITEM_CATEGORIES = [
  "Packaging",
  "Cleaning Materials",
  "Chemicals",
] as const;

export const stockItemsTable = pgTable("stock_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  unit: text("unit").notNull(),
  packWeight: numeric("pack_weight", { precision: 10, scale: 4 }).notNull().default("0"),
  costPerPack: numeric("cost_per_pack", { precision: 10, scale: 4 }).notNull().default("0"),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  secondarySupplierId: integer("secondary_supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierPartNumber: text("supplier_part_number"),
  orderingUrl: text("ordering_url"),
  stockCheckEnabled: boolean("stock_check_enabled").notNull().default(false),
  stockCheckFrequency: text("stock_check_frequency").notNull().default("daily"),
  stockCheckDay: text("stock_check_day"),
  notes: text("notes"),
  kanbanEnabled: boolean("kanban_enabled").notNull().default(false),
  kanbanQuantity: numeric("kanban_quantity", { precision: 10, scale: 4 }).notNull().default("0"),
  kanbanUnit: text("kanban_unit").notNull().default("weight"),
  kanbanOrderAmount: numeric("kanban_order_amount", { precision: 10, scale: 4 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStockItemSchema = createInsertSchema(stockItemsTable).omit({ id: true, createdAt: true });
export type InsertStockItem = z.infer<typeof insertStockItemSchema>;
export type StockItem = typeof stockItemsTable.$inferSelect;
