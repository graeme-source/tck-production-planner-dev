import { pgTable, serial, text, integer, timestamp, numeric, index } from "drizzle-orm/pg-core";
import { subRecipesTable } from "./sub_recipes";
import { productionPlansTable } from "./production_plans";
import { usersTable } from "./users";

// Cook-and-chill record for a cooked sub-recipe (migration 0228, issue #244).
// One row per cooked batch: core temperature at cook-out (FSA time/temperature
// table, never a fixed 75°C), "into blast chiller", "chilling finished".
// Cooling has the same start/finish/who/where shape as the calzone chill
// timer on batch_weight_records, so both report as one cooling log.
export const cookChillRecordsTable = pgTable("cook_chill_records", {
  id: serial("id").primaryKey(),
  subRecipeId: integer("sub_recipe_id").references(() => subRecipesTable.id, { onDelete: "set null" }),
  subRecipeName: text("sub_recipe_name").notNull(),
  planId: integer("plan_id").references(() => productionPlansTable.id, { onDelete: "set null" }),
  cookTempC: numeric("cook_temp_c", { precision: 5, scale: 1 }).notNull(),
  cookHeldForSeconds: integer("cook_held_for_seconds").notNull(),
  cookedBy: integer("cooked_by").references(() => usersTable.id, { onDelete: "set null" }),
  cookedByName: text("cooked_by_name").notNull(),
  cookedAt: timestamp("cooked_at").notNull().defaultNow(),
  chillStartAt: timestamp("chill_start_at"),
  chillStartBy: integer("chill_start_by").references(() => usersTable.id, { onDelete: "set null" }),
  chillStartByName: text("chill_start_by_name"),
  chillEndAt: timestamp("chill_end_at"),
  chillEndBy: integer("chill_end_by").references(() => usersTable.id, { onDelete: "set null" }),
  chillEndByName: text("chill_end_by_name"),
  chilledVia: text("chilled_via"), // 'prep_station' | 'wrapping_station'
}, (t) => [
  index("cook_chill_records_cooked_at_idx").on(t.cookedAt),
]);

export type CookChillRecord = typeof cookChillRecordsTable.$inferSelect;
