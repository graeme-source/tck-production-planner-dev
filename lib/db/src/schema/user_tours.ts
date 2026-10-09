import { pgTable, integer, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// One-off guided walkthroughs a person has finished (migration 0155). Per
// person, not per device, so it follows them across iPads.
export const userToursTable = pgTable("user_tours", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tourKey: text("tour_key").notNull(),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.tourKey] })]);

export type UserTour = typeof userToursTable.$inferSelect;
