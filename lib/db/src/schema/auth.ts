import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userInvitesTable = pgTable("user_invites", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  role: text("role").notNull().default("viewer"),
  // Accountant invite: accepted user gets isBookkeeper, skips the contract
  // claim and the onboarding gate — finance-only access from first login.
  isBookkeeper: boolean("is_bookkeeper").notNull().default(false),
  invitedById: integer("invited_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  invitedAt: timestamp("invited_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
});

export const passwordResetsTable = pgTable("password_resets", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
});
