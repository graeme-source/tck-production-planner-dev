import { pgTable, text, timestamp, integer, date, jsonb, numeric } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/** Current rate of pay and the last pay rise, from Planday (migration 0406).
 *  People access only. Refreshed daily (api services/pay-rate-sync.ts). */
export const peoplePayRatesTable = pgTable("people_pay_rates", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  plandayEmployeeId: integer("planday_employee_id"),
  rates: jsonb("rates").$type<Array<{ rate: number; wageType: string; salaryCode: string; employeeGroupId: number }>>().notNull().default([]),
  currentRate: numeric("current_rate", { precision: 10, scale: 4 }),
  wageType: text("wage_type"),
  lastChangeOn: date("last_change_on"),
  previousRate: numeric("previous_rate", { precision: 10, scale: 4 }),
  changes: jsonb("changes").$type<Array<{ date: string; from: number; to: number }>>().notNull().default([]),
  historyFrom: date("history_from"),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
});
