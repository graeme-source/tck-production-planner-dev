// Employee reviews, probation meetings and the ongoing record of a person's
// time here (Graeme, 2026-09-03). See migration 0071_employee_reviews.sql.
//
// Sensitive personal data: a note is PRIVATE to whoever wrote it until it is
// deliberately shared to the employee's record. Who may read what is decided
// by employee-review-visibility.ts and applied on the server — never by
// hiding rows in the UI.

import { pgTable, serial, text, integer, timestamp, date } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/** A review, probation meeting or 1:1 — booked for a date, written up after. */
export const employeeMeetingsTable = pgTable("employee_meetings", {
  id: serial("id").primaryKey(),
  subjectUserId: integer("subject_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /** 'review' | 'probation' | 'one_to_one' */
  kind: text("kind").notNull().default("review"),
  title: text("title"),
  scheduledFor: date("scheduled_for"),
  heldAt: timestamp("held_at"),
  /** 'booked' | 'held' | 'cancelled' */
  status: text("status").notNull().default("booked"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** The diary: notes, feedback and objectives about one person. */
export const employeeNotesTable = pgTable("employee_notes", {
  id: serial("id").primaryKey(),
  subjectUserId: integer("subject_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // Stands alone or belongs to a meeting. Deleting the meeting must never
  // destroy what was written about the person, hence set null.
  meetingId: integer("meeting_id").references(() => employeeMeetingsTable.id, { onDelete: "set null" }),
  /** 'note' | 'feedback' | 'objective' */
  kind: text("kind").notNull().default("note"),
  body: text("body").notNull(),
  /** 'private' | 'shared' — private until deliberately published. */
  visibility: text("visibility").notNull().default("private"),
  sharedAt: timestamp("shared_at"),
  /** Objectives only. */
  dueDate: date("due_date"),
  doneAt: timestamp("done_at"),
  authorId: integer("author_id").references(() => usersTable.id, { onDelete: "set null" }),
  authorName: text("author_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type EmployeeMeeting = typeof employeeMeetingsTable.$inferSelect;
export type EmployeeNote = typeof employeeNotesTable.$inferSelect;
