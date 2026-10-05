import { pgTable, serial, text, integer, timestamp, date } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { recipesTable } from "./recipes";

// Club Special changeovers (migration 0148). The planner switches
// is_current_special on switch_on and updates Shopify — see
// api-server/src/lib/club-special-changeover.ts.
export const clubSpecialChangeoversTable = pgTable("club_special_changeovers", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  deliveringFrom: date("delivering_from").notNull(),
  switchOn: date("switch_on").notNull(),
  clubPricePence: integer("club_price_pence"),
  announcement: text("announcement"),
  // scheduled | switched | cancelled
  status: text("status").notNull().default("scheduled"),
  switchedAt: timestamp("switched_at"),
  shopifyError: text("shopify_error"),
  ownerId: integer("owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  // No Drizzle reference: todo_tasks has no Drizzle schema (FKs in 0148).
  zapietEndTodoId: integer("zapiet_end_todo_id"),
  zapietStartTodoId: integer("zapiet_start_todo_id"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at"),
  cancelledByName: text("cancelled_by_name"),
});
