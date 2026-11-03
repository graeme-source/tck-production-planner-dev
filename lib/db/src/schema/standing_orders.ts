/**
 * Standing weekly orders (Fix queue #348, migration 0348). The setting
 * itself lives on ingredients (standingOrderWeekdays / standingOrderPacks);
 * this table records what happened to it on a given London day so it
 * doesn't come back once dealt with: 'ordered' (on a placed purchase order —
 * poId) or 'skipped' ("Not today"). No row = still to order. Objective C.
 */
import { pgTable, integer, date, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { ingredientsTable } from "./ingredients";
import { usersTable } from "./users";

export const standingOrderMarksTable = pgTable("standing_order_marks", {
  orderDate: date("order_date").notNull(),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "cascade" }),
  mark: text("mark").notNull(),
  poId: integer("po_id"),
  markedByUserId: integer("marked_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  markedByName: text("marked_by_name"),
  markedAt: timestamp("marked_at").notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.orderDate, t.ingredientId] }),
}));

export type StandingOrderMarkRow = typeof standingOrderMarksTable.$inferSelect;
