import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Staff emergency contacts (migration 0145) — one current contact per
// person. The onboarding form writes through to here; the person, and
// managers/admins, keep it up to date. Reads of a colleague's are logged
// in staff_emergency_contact_views.
export const staffEmergencyContactsTable = pgTable("staff_emergency_contacts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  relationship: text("relationship"),
  secondName: text("second_name"),
  secondPhone: text("second_phone"),
  secondRelationship: text("second_relationship"),
  /** self | manager | onboarding */
  source: text("source").notNull().default("self"),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const staffEmergencyContactViewsTable = pgTable("staff_emergency_contact_views", {
  id: serial("id").primaryKey(),
  viewerId: integer("viewer_id").references(() => usersTable.id, { onDelete: "set null" }),
  viewerName: text("viewer_name"),
  subjectUserId: integer("subject_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  subjectName: text("subject_name"),
  /** view | edit */
  action: text("action").notNull().default("view"),
  /** contacts_page | station | people_record */
  source: text("source").notNull(),
  viewedAt: timestamp("viewed_at").notNull().defaultNow(),
});

export type StaffEmergencyContact = typeof staffEmergencyContactsTable.$inferSelect;
