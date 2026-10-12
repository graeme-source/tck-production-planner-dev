import { pgTable, integer, jsonb, timestamp, primaryKey, text } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { productionPlansTable } from "./production_plans";

/** One tick on a dough mix: when, and by whom (app_users.id). */
export type DoughMixTick = { at: string; by: number | null };

// Dough Prep mix progress (migrations 0176, 0177). plan_id = the plan the
// dough is FOR. dough_key = 'day_before' (the calzone dough, the station's
// tracking plan) or 'same_day:<subRecipeId>' (a dough made on the production
// day itself). API: routes/dough-mix-progress.ts.
export const doughMixProgressTable = pgTable(
  "dough_mix_progress",
  {
    planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
    doughKey: text("dough_key").notNull().default("day_before"),
    mixNo: integer("mix_no").notNull(),
    ticks: jsonb("ticks").$type<Record<string, DoughMixTick>>().notNull().default({}),
    completedAt: timestamp("completed_at"),
    completedByUserId: integer("completed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.planId, t.doughKey, t.mixNo] })],
);

export type DoughMixProgressRow = typeof doughMixProgressTable.$inferSelect;
