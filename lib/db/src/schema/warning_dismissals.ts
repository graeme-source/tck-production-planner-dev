import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/** Who dismissed an operational warning, and when (migration 0387). */
export const warningDismissalsTable = pgTable("warning_dismissals", {
  id: serial("id").primaryKey(),
  warning: text("warning").notNull(),
  action: text("action").notNull(),
  detail: text("detail"),
  page: text("page"),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("warning_dismissals_created_idx").on(t.createdAt)]);

export type WarningDismissal = typeof warningDismissalsTable.$inferSelect;
