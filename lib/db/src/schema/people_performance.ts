import { pgTable, serial, text, timestamp, integer, date, jsonb, unique, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { peopleRecordEntriesTable } from "./people_record";

/** A manager's private notes before someone's performance review (0394).
 *  One running note per (person, author); only the author reads it. */
export const peoplePerformancePrepTable = pgTable("people_performance_prep", {
  id: serial("id").primaryKey(),
  subjectUserId: integer("subject_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  authorUserId: integer("author_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  body: text("body").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => [unique("uq_people_performance_prep").on(t.subjectUserId, t.authorUserId)]);

/** A frozen performance data report, attached to a meeting (0394). The
 *  employee sees it only once shared (shared_at). */
export const peoplePerformanceReportsTable = pgTable("people_performance_reports", {
  id: serial("id").primaryKey(),
  subjectUserId: integer("subject_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  entryId: integer("entry_id").references(() => peopleRecordEntriesTable.id, { onDelete: "set null" }),
  periodFrom: date("period_from").notNull(),
  periodTo: date("period_to").notNull(),
  data: jsonb("data").notNull(),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  sharedAt: timestamp("shared_at"),
  sharedBy: integer("shared_by").references(() => usersTable.id, { onDelete: "set null" }),
}, t => [index("people_performance_reports_subject_idx").on(t.subjectUserId, t.createdAt)]);
