// Employment contracts (migration 0082). The founder keeps one master
// template with {{placeholders}}; generated contracts are immutable filled
// snapshots delivered to exactly one employee's hub. Access rules live in
// routes/contracts.ts: template + issued list are founder-only, a contract
// body is readable by its owner and the founder, nobody else.

import { pgTable, serial, text, integer, timestamp, date, customType, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Postgres `bytea` — stored / returned as Buffer (same pattern as
// risk_assessments and onboarding documents).
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const contractTemplatesTable = pgTable("contract_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("Master employment contract"),
  body: text("body").notNull(),
  defaultJobTitle: text("default_job_title").notNull().default("Food Production Operative"),
  defaultWeeklyHours: text("default_weekly_hours").notNull().default("41.25"),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const employmentContractsTable = pgTable("employment_contracts", {
  id: serial("id").primaryKey(),
  // Nullable since migration 0088: a contract can be addressed to a pending
  // invite's email instead, and is claimed onto the account when the invite
  // is accepted. One of userId / inviteEmail is always set (DB CHECK).
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  inviteEmail: text("invite_email"),
  templateId: integer("template_id").references(() => contractTemplatesTable.id, { onDelete: "set null" }),
  // The filled contract text — a snapshot: template edits never reach back
  // into an issued contract.
  body: text("body").notNull(),
  employeeName: text("employee_name").notNull(),
  jobTitle: text("job_title").notNull(),
  rateOfPay: text("rate_of_pay").notNull(),
  weeklyHours: text("weekly_hours").notNull(),
  startDate: date("start_date").notNull(),
  issueDate: date("issue_date").notNull(),
  issuedBy: integer("issued_by").references(() => usersTable.id, { onDelete: "set null" }),
  issuedAt: timestamp("issued_at").notNull().defaultNow(),
  // The employee's in-app signature: acknowledged_at is the moment they
  // signed, signed_initials the initials they typed (also written into the
  // body as the electronic signature record). Once set, the contract can no
  // longer be deleted.
  acknowledgedAt: timestamp("acknowledged_at"),
  signedInitials: text("signed_initials"),
  // The archival hard copy, generated at signing (migration 0085). DB
  // triggers make signed rows undeletable and immutable; a NULL pdf may be
  // backfilled once since it derives from the frozen body.
  signedPdf: bytea("signed_pdf"),
});

// A previous contract filed as the document it is — a PDF or a photo of the
// paper copy (migration 0130). Separate from employment_contracts on purpose:
// those were issued and signed in the app and are protected by the signed-
// contract triggers; an upload never was, and must never look as if it had
// been. Visible to the HR-records accounts and the employee themself only
// (routes/uploaded-contracts.ts, rules in lib/uploaded-contract-access.ts).
export const uploadedContractsTable = pgTable("uploaded_contracts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  fileName: text("file_name"),
  mime: text("mime").notNull(),
  data: bytea("data").notNull(),
  byteSize: integer("byte_size").notNull(),
  originalIssueDate: date("original_issue_date"),
  notes: text("notes"),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  uploadedByName: text("uploaded_by_name"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  extraction: jsonb("extraction"),
  extractedAt: timestamp("extracted_at"),
  prefill: jsonb("prefill"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ContractTemplate = typeof contractTemplatesTable.$inferSelect;
export type EmploymentContract = typeof employmentContractsTable.$inferSelect;
export type UploadedContract = typeof uploadedContractsTable.$inferSelect;
