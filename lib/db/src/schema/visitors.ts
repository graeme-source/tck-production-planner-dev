/**
 * Digital visitor book — the paper book by the door, in the app.
 *
 * Every visitor signs themselves in on the iPad before entering the unit:
 * name, who they're here to see, and three food-safety declarations (illness
 * in the last 48 hours, loose jewellery removed, PPE agreed). The date and
 * time are stamped by the server, not typed by the visitor, so the log is
 * audit-evidence for EHO / SALSA rather than a self-reported list.
 *
 * A "yes" to the illness question does NOT get thrown away — the row is still
 * written with entryPermitted = false, because "we asked and we turned them
 * away" is exactly the evidence an inspector wants to see.
 *
 * signedOutAt doubles as the fire roll-call: anyone with a NULL sign-out is
 * still on site.
 */
import { pgTable, serial, text, boolean, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";

export const visitorLogTable = pgTable("visitor_log", {
  id: serial("id").primaryKey(),
  visitorName: text("visitor_name").notNull(),
  company: text("company"),
  // Free text — visitors won't know our staff list, and typing a name is
  // faster than scrolling a picker on a handed-over iPad.
  visiting: text("visiting"),
  purpose: text("purpose"),
  // Answer to "Have you had sickness or diarrhoea in the last 48 hours?"
  // TRUE means they HAVE been ill — the fail case.
  illnessLast48h: boolean("illness_last_48h").notNull(),
  jewelleryRemoved: boolean("jewellery_removed").notNull().default(false),
  ppeAgreed: boolean("ppe_agreed").notNull().default(false),
  // FALSE when the illness declaration blocks entry. Kept as its own column so
  // the log can be filtered on "refused entry" without re-deriving the rule.
  entryPermitted: boolean("entry_permitted").notNull().default(true),
  signedInAt: timestamp("signed_in_at").notNull().defaultNow(),
  signedOutAt: timestamp("signed_out_at"),
  // The staff account the check-in iPad was logged in as — who supervised the
  // sign-in, not the visitor.
  recordedByUserId: integer("recorded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  recordedByName: text("recorded_by_name"),
  signedOutByUserId: integer("signed_out_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  signedOutByName: text("signed_out_by_name"),
  // Manager note — e.g. why someone was let in / turned away.
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  signedInIdx: index("ix_visitor_log_signed_in").on(t.signedInAt),
}));

export type VisitorLogEntry = typeof visitorLogTable.$inferSelect;

export const insertVisitorLogSchema = createInsertSchema(visitorLogTable).omit({ id: true, createdAt: true });
