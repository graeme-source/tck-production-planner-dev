import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Who may open the People section (migration 0126). One row per person who
// has it; no row = no access. A role never grants it, and only the founder
// account can add or remove a row (routes/people-access.ts). Replaces the
// old hard-coded PEOPLE_DATA_EMAILS list.
export const peopleAccessGrantsTable = pgTable("people_access_grants", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  grantedByUserId: integer("granted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
});

// Every grant and revoke, kept after the grant row is gone.
export const peopleAccessAuditTable = pgTable("people_access_audit", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userEmail: text("user_email"),
  action: text("action").notNull(), // 'grant' | 'revoke'
  byUserId: integer("by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PeopleAccessGrant = typeof peopleAccessGrantsTable.$inferSelect;
