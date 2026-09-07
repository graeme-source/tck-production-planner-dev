// Starter form submissions (migration 0086): the HMRC starter checklist,
// payroll details and health questionnaire, filled and signed in-app. One
// row per (user, form). Access rules live in routes/starter-forms.ts —
// owner + HR-records access only. Signed rows are frozen by DB triggers.

import { pgTable, serial, text, integer, timestamp, jsonb, unique, customType } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const starterFormSubmissionsTable = pgTable("starter_form_submissions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  formType: text("form_type").notNull(),
  answers: jsonb("answers").notNull().default({}),
  // Rendered plain-text document, frozen at signing (NULL while a draft).
  body: text("body"),
  signedInitials: text("signed_initials"),
  signedAt: timestamp("signed_at"),
  signedPdf: bytea("signed_pdf"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_starter_form_submission").on(table.userId, table.formType),
]);

export type StarterFormSubmission = typeof starterFormSubmissionsTable.$inferSelect;
