import { pgTable, serial, text, numeric, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
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
  category: text("category"),
  processingRatio: numeric("processing_ratio", { precision: 5, scale: 4 }),
  prepWeightMode: text("prep_weight_mode").notNull().default("raw"),
  rawMeatTrayCapacityKg: numeric("raw_meat_tray_capacity_kg", { precision: 10, scale: 4 }),
  minCookingTempC: numeric("min_cooking_temp_c", { precision: 5, scale: 2 }),
  estimatedCookTimeMin: integer("estimated_cook_time_min"),
  ovenTempC: integer("oven_temp_c"),
  steamPct: integer("steam_pct"),
  stockCheckEnabled: boolean("stock_check_enabled").notNull().default(false),
  stockCheckFrequency: text("stock_check_frequency").notNull().default("daily"),
  stockCheckDay: text("stock_check_day"),
  surplusPercent: numeric("surplus_percent", { precision: 8, scale: 2 }).notNull().default("10"),
  surplusMode: text("surplus_mode").notNull().default("percent"),
  surplusAbsoluteQty: numeric("surplus_absolute_qty", { precision: 12, scale: 4 }),
  shelfLifeDays: integer("shelf_life_days"),
  requiresUseByDate: boolean("requires_use_by_date").notNull().default(false),
  // When true, this ingredient is stock-checked, ordered and received in
  // whole packs (e.g. bottles of milk) rather than its native weight/volume.
  // Recipes and prep always use the native unit. Requires packWeight > 0.
  stockInPacks: boolean("stock_in_packs").notNull().default(false),
  kanbanEnabled: boolean("kanban_enabled").notNull().default(false),
  kanbanQuantity: numeric("kanban_quantity", { precision: 10, scale: 4 }).notNull().default("0"),
  kanbanUnit: text("kanban_unit").notNull().default("weight"),
  kanbanOrderAmount: numeric("kanban_order_amount", { precision: 10, scale: 4 }),
  perishable: boolean("perishable").notNull().default(true),
  palletSize: integer("pallet_size"),
  energyKj: numeric("energy_kj", { precision: 10, scale: 2 }),
  energyKcal: numeric("energy_kcal", { precision: 10, scale: 2 }),
  fat: numeric("fat", { precision: 10, scale: 2 }),
  saturates: numeric("saturates", { precision: 10, scale: 2 }),
  carbohydrate: numeric("carbohydrate", { precision: 10, scale: 2 }),
  sugars: numeric("sugars", { precision: 10, scale: 2 }),
  protein: numeric("protein", { precision: 10, scale: 2 }),
  fibre: numeric("fibre", { precision: 10, scale: 2 }),
  salt: numeric("salt", { precision: 10, scale: 2 }),
  labelDeclaration: text("label_declaration"),
  allergens: jsonb("allergens").$type<string[]>().default([]),
  qrCodeUrl: text("qr_code_url"),
  isBottle: boolean("is_bottle").notNull().default(false),
  bottleSize: numeric("bottle_size", { precision: 10, scale: 4 }),
  // Display override for the prep station — when set, the quantity shown on
  // the prep sheet becomes portions × count with unit "pieces", instead of
  // the normal kg/g. Used for things like pigs & blankets (1 per portion).
  // The recipe's underlying kg quantity is unchanged — orders, stock,
  // labelling, raw-material maths all still use the original weight.
  prepCountPerPortion: integer("prep_count_per_portion"),
  // Marks the ingredient as a pasta-type product. When true, its weight
  // contributes to the plan-level pasta-cooking synthetic rows (cooking
  // water + salt) driven by the admin settings pasta_cooking_water_l_per_kg
  // and pasta_cooking_salt_g_per_kg. Purely a prep-display mechanism; no
  // impact on ordering, stock, or label weight.
  isPasta: boolean("is_pasta").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertIngredientSchema = createInsertSchema(ingredientsTable).omit({ id: true, createdAt: true });
export type InsertIngredient = z.infer<typeof insertIngredientSchema>;
export type Ingredient = typeof ingredientsTable.$inferSelect;
