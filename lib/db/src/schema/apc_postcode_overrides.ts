import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// What APC customer service told us about a postcode restriction (migration
// 0144), applied on top of APC's POSTINFO table by
// api-server/src/services/apc-postcode-overrides.ts. Never hard-deleted.
export const apcPostcodeOverridesTable = pgTable("apc_postcode_overrides", {
  id: serial("id").primaryKey(),
  /** Outward code the POSTINFO row matched on, e.g. "KA3". */
  outward: text("outward").notNull(),
  /** saturday | weekday */
  service: text("service").notNull(),
  /** temporary | permanent */
  kind: text("kind").notNull(),
  note: text("note"),
  depot: text("depot"),
  recordedById: integer("recorded_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  recordedByName: text("recorded_by_name"),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  clearedAt: timestamp("cleared_at"),
  clearedById: integer("cleared_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  clearedByName: text("cleared_by_name"),
});

export type ApcPostcodeOverride = typeof apcPostcodeOverridesTable.$inferSelect;
