import { pgTable, serial, integer, numeric, date, text, timestamp } from "drizzle-orm/pg-core";
import { ingredientsTable } from "./ingredients";
import { suppliersTable } from "./suppliers";
import { productionPlansTable } from "./production_plans";
import { purchaseOrdersTable } from "./ordering";
import { usersTable } from "./users";

/**
 * Part of an Orders line moved to another supplier's next order day
 * ("Split with another supplier", fix-queue #248 + #328). Migration 0241.
 * Rules: api-server lib/order-split-rules.ts.
 */
export const orderLineSplitsTable = pgTable("order_line_splits", {
  id: serial("id").primaryKey(),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "cascade" }),
  packs: numeric("packs", { precision: 10, scale: 2 }).notNull(),
  fromSupplierId: integer("from_supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  fromPlanId: integer("from_plan_id").references(() => productionPlansTable.id, { onDelete: "set null" }),
  fromOrderDate: date("from_order_date").notNull(),
  targetSupplierId: integer("target_supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  targetOrderDate: date("target_order_date").notNull(),
  /** 'pending' | 'placed' | 'cancelled' */
  status: text("status").notNull().default("pending"),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrdersTable.id, { onDelete: "set null" }),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  placedAt: timestamp("placed_at"),
  cancelledByUserId: integer("cancelled_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  cancelledAt: timestamp("cancelled_at"),
});

export type OrderLineSplit = typeof orderLineSplitsTable.$inferSelect;
