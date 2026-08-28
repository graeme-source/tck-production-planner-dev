import { pgTable, serial, text, boolean, timestamp, pgEnum, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", ["admin", "manager", "viewer"]);

export const usersTable = pgTable("app_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("viewer"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  pinHash: text("pin_hash"),
  pinAttempts: integer("pin_attempts").notNull().default(0),
  pinLockedUntil: timestamp("pin_locked_until"),
  avatarUrl: text("avatar_url"),
  plandayEmployeeId: integer("planday_employee_id"),
  // Set true when a user is created by accepting an invite, so they're gated
  // into the pre-arrival onboarding form once. Existing staff stay false.
  onboardingRequired: boolean("onboarding_required").notNull().default(false),
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  // Forced password reset. When set and in the future the client shows a
  // countdown warning; once passed, a full-screen blocker forces the change.
  // Cleared (and passwordChangedAt stamped) whenever the password is changed,
  // which also keeps the boot-time seed from ever re-flagging the user.
  passwordResetDeadline: timestamp("password_reset_deadline"),
  passwordChangedAt: timestamp("password_changed_at"),
  // Production-planner capability flag: a manager subtype. Gates planning
  // surfaces like the weekly DPT sales suggestion (admins always qualify).
  isProductionPlanner: boolean("is_production_planner").notNull().default(false),
  // Bookkeeper capability flag: gates the finance/VAT-reconciliation pages
  // (admins always qualify). Bookkeepers see finance and nothing of kitchen
  // operations' admin surfaces; kitchen roles don't see finance.
  isBookkeeper: boolean("is_bookkeeper").notNull().default(false),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
