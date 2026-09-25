// Documents filed on a person's record (migration 0132) — letters,
// certificates, right-to-work evidence, warnings, anything else, as a PDF or
// a photo. Never hard-deleted (deleted_at + a trigger that refuses DELETE).
// Who sees what: routes/person-documents.ts, rules + tests in
// artifacts/api-server/src/lib/person-document-rules.ts.

import { pgTable, serial, text, integer, timestamp, date, boolean, customType } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Postgres `bytea` — stored / returned as Buffer (same pattern as
// uploaded_contracts and onboarding documents).
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const personDocumentsTable = pgTable("person_documents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  // 'letter' | 'certificate' | 'right_to_work' | 'training_certificate'
  // | 'warning' | 'disciplinary' | 'other' (CHECK in the migration)
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  documentDate: date("document_date").notNull(),
  notes: text("notes"),
  fileName: text("file_name"),
  mime: text("mime").notNull(),
  byteSize: integer("byte_size").notNull(),
  data: bytea("data").notNull(),
  // 'people' = People-access users; 'hr' = HR-records accounts only
  visibility: text("visibility").notNull(),
  sharedWithEmployee: boolean("shared_with_employee").notNull().default(false),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  uploadedByName: text("uploaded_by_name"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: integer("deleted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  deletedByName: text("deleted_by_name"),
});

export type PersonDocument = typeof personDocumentsTable.$inferSelect;
