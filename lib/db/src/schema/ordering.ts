import { pgTable, serial, text, numeric, integer, timestamp, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ingredientsTable } from "./ingredients";
import { suppliersTable } from "./suppliers";
import { usersTable } from "./users";
import { productionPlansTable } from "./production_plans";

export const storageLocationsTable = pgTable("storage_locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  zone: text("zone").notNull().default("fridge"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const storageRacksTable = pgTable("storage_racks", {
  id: serial("id").primaryKey(),
  locationId: integer("location_id").notNull().references(() => storageLocationsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
});

export const ingredientStorageLocationsTable = pgTable("ingredient_storage_locations", {
  id: serial("id").primaryKey(),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "cascade" }),
  locationId: integer("location_id").notNull().references(() => storageLocationsTable.id, { onDelete: "cascade" }),
  rackLabel: text("rack_label"),
  shelfLabel: text("shelf_label"),
});

export const stockTransfersTable = pgTable("stock_transfers", {
  id: serial("id").primaryKey(),
  ingredientId: integer("ingredient_id").references(() => ingredientsTable.id, { onDelete: "set null" }),
  fromLocation: text("from_location").notNull(),
  toLocation: text("to_location").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 4 }).notNull(),
  unit: text("unit").notNull(),
  transferredAt: timestamp("transferred_at").notNull().defaultNow(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  notes: text("notes"),
});

export const purchaseOrdersTable = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
  planId: integer("plan_id").references(() => productionPlansTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  placedAt: timestamp("placed_at"),
  expectedDeliveryDate: date("expected_delivery_date"),
  notes: text("notes"),
  placedByUserId: integer("placed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
});

export const purchaseOrderLinesTable = pgTable("purchase_order_lines", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").notNull().references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "restrict" }),
  quantityRequired: numeric("quantity_required", { precision: 10, scale: 4 }).notNull().default("0"),
  quantityOrdered: numeric("quantity_ordered", { precision: 10, scale: 4 }).notNull().default("0"),
  quantityReceived: numeric("quantity_received", { precision: 10, scale: 4 }).notNull().default("0"),
  unit: text("unit").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 4 }),
  checkedOff: boolean("checked_off").notNull().default(false),
  notes: text("notes"),
});

export const deliveryRecordsTable = pgTable("delivery_records", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrdersTable.id, { onDelete: "set null" }),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  receivedByUserId: integer("received_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  chilledTempC: numeric("chilled_temp_c", { precision: 5, scale: 1 }),
  frozenTempC: numeric("frozen_temp_c", { precision: 5, scale: 1 }),
  invoiceFiled: boolean("invoice_filed").notNull().default(false),
  allPutAway: boolean("all_put_away").notNull().default(false),
  kanbansReplaced: boolean("kanbans_replaced").notNull().default(false),
  notes: text("notes"),
});

export const deliveryCheckConfigsTable = pgTable("delivery_check_configs", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  isRequired: boolean("is_required").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const deliveryCheckResultsTable = pgTable("delivery_check_results", {
  id: serial("id").primaryKey(),
  deliveryRecordId: integer("delivery_record_id").notNull().references(() => deliveryRecordsTable.id, { onDelete: "cascade" }),
  checkConfigId: integer("check_config_id").notNull().references(() => deliveryCheckConfigsTable.id, { onDelete: "cascade" }),
  passed: boolean("passed").notNull().default(false),
  notes: text("notes"),
});

export const kanbanItemsTable = pgTable("kanban_items", {
  id: serial("id").primaryKey(),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  pulledAt: timestamp("pulled_at"),
  pulledByUserId: integer("pulled_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  orderDayTarget: date("order_day_target"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const dptIngredientRequirementsTable = pgTable("dpt_ingredient_requirements", {
  id: serial("id").primaryKey(),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "cascade" }),
  dailyQtyRaw: numeric("daily_qty_raw", { precision: 10, scale: 4 }).notNull().default("0"),
  dailyQtyCooked: numeric("daily_qty_cooked", { precision: 10, scale: 4 }).notNull().default("0"),
  unit: text("unit").notNull(),
  calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
});

export const insertStorageLocationSchema = createInsertSchema(storageLocationsTable).omit({ id: true, createdAt: true });
export const insertStorageRackSchema = createInsertSchema(storageRacksTable).omit({ id: true });
export const insertIngredientStorageLocationSchema = createInsertSchema(ingredientStorageLocationsTable).omit({ id: true });
export const insertStockTransferSchema = createInsertSchema(stockTransfersTable).omit({ id: true });
export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrdersTable).omit({ id: true, createdAt: true });
export const insertPurchaseOrderLineSchema = createInsertSchema(purchaseOrderLinesTable).omit({ id: true });
export const insertDeliveryRecordSchema = createInsertSchema(deliveryRecordsTable).omit({ id: true });
export const insertDeliveryCheckConfigSchema = createInsertSchema(deliveryCheckConfigsTable).omit({ id: true });
export const insertKanbanItemSchema = createInsertSchema(kanbanItemsTable).omit({ id: true, createdAt: true });
export const insertDptIngredientRequirementSchema = createInsertSchema(dptIngredientRequirementsTable).omit({ id: true });

export type StorageLocation = typeof storageLocationsTable.$inferSelect;
export type StorageRack = typeof storageRacksTable.$inferSelect;
export type IngredientStorageLocation = typeof ingredientStorageLocationsTable.$inferSelect;
export type StockTransfer = typeof stockTransfersTable.$inferSelect;
export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;
export type PurchaseOrderLine = typeof purchaseOrderLinesTable.$inferSelect;
export type DeliveryRecord = typeof deliveryRecordsTable.$inferSelect;
export type DeliveryCheckConfig = typeof deliveryCheckConfigsTable.$inferSelect;
export type DeliveryCheckResult = typeof deliveryCheckResultsTable.$inferSelect;
export type KanbanItem = typeof kanbanItemsTable.$inferSelect;
export type DptIngredientRequirement = typeof dptIngredientRequirementsTable.$inferSelect;
