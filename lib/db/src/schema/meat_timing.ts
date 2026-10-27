import { pgTable, serial, text, integer, numeric, timestamp, index, date, boolean, unique } from "drizzle-orm/pg-core";
import { productionPlansTable } from "./production_plans";
import { usersTable } from "./users";
import { ingredientsTable } from "./ingredients";

// Self-correcting prep-oven timings (migration 0290): every change to a raw
// meat's processing or grace minutes — automatic, by hand, or a revert —
// with the evidence behind it. Cook time never appears here.
export const meatTimingAdjustmentsTable = pgTable("meat_timing_adjustments", {
  id: serial("id").primaryKey(),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "cascade" }),
  ingredientName: text("ingredient_name").notNull(),
  field: text("field").notNull(), // 'process' | 'grace'
  oldValue: integer("old_value"),
  newValue: integer("new_value").notNull(),
  source: text("source").notNull(), // 'auto' | 'manual' | 'revert'
  reason: text("reason").notNull(),
  runsUsed: integer("runs_used"),
  leadMedianMinutes: numeric("lead_median_minutes", { precision: 7, scale: 1 }),
  leadSlowMinutes: numeric("lead_slow_minutes", { precision: 7, scale: 1 }),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  actorName: text("actor_name"),
  revertedAt: timestamp("reverted_at", { withTimezone: true }),
  revertedByName: text("reverted_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("meat_timing_adjustments_ingredient_idx").on(t.ingredientId, t.createdAt)]);

export type MeatTimingAdjustment = typeof meatTimingAdjustmentsTable.$inferSelect;

// The daily review (migration 0290): one row per raw meat x recipe x plan,
// made when its first tray goes into the prep oven, judged after production.
export const meatPutInRecordsTable = pgTable("meat_put_in_records", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  planDate: date("plan_date").notNull(),
  recipeId: integer("recipe_id").notNull(),
  recipeName: text("recipe_name").notNull(),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "cascade" }),
  ingredientName: text("ingredient_name").notNull(),
  suggestedAtMinutes: integer("suggested_at_minutes"),
  plannedAtMinutes: integer("planned_at_minutes"),
  leadMinutes: integer("lead_minutes"),
  putInAt: timestamp("put_in_at", { withTimezone: true }).notNull(),
  putInMinutes: integer("put_in_minutes").notNull(),
  deviationMinutes: integer("deviation_minutes"),
  reasonCode: text("reason_code"),
  reasonNote: text("reason_note"),
  reasonByName: text("reason_by_name"),
  reasonAt: timestamp("reason_at", { withTimezone: true }),
  readyAtMinutes: integer("ready_at_minutes"),
  neededAtMinutes: integer("needed_at_minutes"),
  outcome: text("outcome"),
  cause: text("cause"),
  followed: boolean("followed"),
  waitMinutes: integer("wait_minutes"),
  satMinutes: integer("sat_minutes"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("meat_put_in_records_plan_id_recipe_id_ingredient_id_key").on(t.planId, t.recipeId, t.ingredientId),
  index("meat_put_in_records_ingredient_idx").on(t.ingredientId, t.planDate),
]);

export type MeatPutInRecord = typeof meatPutInRecordsTable.$inferSelect;
