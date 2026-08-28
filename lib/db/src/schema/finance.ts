import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  date,
  jsonb,
  customType,
} from "drizzle-orm/pg-core";

// Finance / VAT invoice reconciliation (docs/vat-reconciliation/PLAN.md).
// MVP scope: card-statement lines + mailbox-found documents + bookkeeper
// dashboard. No QuickBooks in this phase, by decision (Graeme, 27 Aug 2026).

// Postgres `bytea` — stored / returned as Buffer (same pattern as
// risk_assessments / onboarding / collections).
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

// Supplier knowledge base — the advisory layer. Every field a human edits is
// "confirmed"; harvested/guessed values stay estimates (detailsConfirmed).
export const finVendorsTable = pgTable("fin_vendors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  normalisedName: text("normalised_name").notNull().unique(),
  website: text("website"),
  accountsEmail: text("accounts_email"),
  phone: text("phone"),
  contactName: text("contact_name"),
  portalUrl: text("portal_url"),
  // 'emails_pdf' | 'on_request' | 'portal' | 'never' | 'unknown'
  invoiceBehaviour: text("invoice_behaviour").notNull().default("unknown"),
  // 'standard' | 'zero' | 'mixed' | 'none' | 'unknown' — none = no UK VAT
  // (international/SaaS), where a receipt or order confirmation suffices.
  vatExpectation: text("vat_expectation").notNull().default("unknown"),
  notes: text("notes"),
  detailsConfirmed: boolean("details_confirmed").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const finStatementUploadsTable = pgTable("fin_statement_uploads", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(), // 'capital_on_tap' | 'allica' | 'backlog_seed'
  fileName: text("file_name"),
  rowCount: integer("row_count").notNull().default(0),
  newCount: integer("new_count").notNull().default(0),
  duplicateCount: integer("duplicate_count").notNull().default(0),
  uploadedBy: integer("uploaded_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// The central work queue. One row per card/statement line needing evidence.
export const finLinesTable = pgTable("fin_lines", {
  id: serial("id").primaryKey(),
  uploadId: integer("upload_id"),
  source: text("source").notNull(), // 'capital_on_tap' | 'allica' | 'backlog_seed'
  lineDate: date("line_date").notNull(), // clearance date (or sheet date)
  authDate: date("auth_date"), // authorisation date when known
  descriptor: text("descriptor").notNull(),
  merchant: text("merchant"), // pre-cleaned merchant name where the CSV has one
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("GBP"),
  originalAmount: numeric("original_amount", { precision: 12, scale: 2 }),
  originalCurrency: text("original_currency"),
  cardLast4: text("card_last4"),
  cardholder: text("cardholder"),
  vendorId: integer("vendor_id"),
  // 'open' | 'identified' | 'matched' | 'done' | 'not_needed'
  // done = bookkeeper has what they need; not_needed = no evidence required
  // (e.g. repayment noise, personal, or admin decision — reason in statusNote).
  status: text("status").notNull().default("open"),
  statusNote: text("status_note"),
  doneAt: timestamp("done_at"),
  doneBy: integer("done_by"),
  // Set when the QuickBooks sync matches this line to a posted
  // transaction — the "ruled out, already posted" signal.
  qboTxnId: integer("qbo_txn_id"),
  postedDetectedAt: timestamp("posted_detected_at"),
  // sha256 over source|dates|amount|descriptor|card — makes re-uploads of
  // overlapping exports safe (dedupe on conflict).
  dedupeHash: text("dedupe_hash").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Documents: invoices/receipts/confirmations. Append-only — superseding, not
// deleting (6-year HMRC retention). Stored inline as bytea like risk_assessments.
export const finDocumentsTable = pgTable("fin_documents", {
  id: serial("id").primaryKey(),
  lineId: integer("line_id").notNull(),
  fileBlob: bytea("file_blob").notNull(),
  fileMime: text("file_mime").notNull(),
  fileName: text("file_name").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  // 'manual_upload' | 'imap_attachment' | 'email_body_render' | 'photo'
  docSource: text("doc_source").notNull(),
  sourceRef: text("source_ref"), // e.g. "INBOX:12345" for a mail attachment
  // 'invoice' | 'receipt' | 'order_confirmation' | 'other' — human/heuristic label
  docKind: text("doc_kind").notNull().default("other"),
  uploadedBy: integer("uploaded_by"),
  supersededBy: integer("superseded_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Lightweight local index of invoice-like mailbox messages. Metadata +
// extracted features ONLY — never bodies (privacy minimisation, see plan).
export const finEmailIndexTable = pgTable("fin_email_index", {
  id: serial("id").primaryKey(),
  folder: text("folder").notNull(),
  imapUid: integer("imap_uid").notNull(),
  messageIdHdr: text("message_id_hdr"),
  fromAddress: text("from_address"),
  fromDomain: text("from_domain"),
  subject: text("subject"),
  internalDate: timestamp("internal_date"),
  hasPdf: boolean("has_pdf").notNull().default(false),
  // amounts found in subject/body during the transient scan, as strings to
  // avoid float drift ("48.98"); body itself is discarded.
  amountsFound: jsonb("amounts_found").$type<string[]>().notNull().default([]),
  orderIdsFound: jsonb("order_ids_found").$type<string[]>().notNull().default([]),
  // First ~400 chars of the email text — enough to recognise it; never the
  // full body (privacy minimisation).
  snippet: text("snippet"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Candidate matches between a line and an indexed message.
export const finMatchesTable = pgTable("fin_matches", {
  id: serial("id").primaryKey(),
  lineId: integer("line_id").notNull(),
  emailIndexId: integer("email_index_id").notNull(),
  score: integer("score").notNull(), // 0-100
  // How many of the four signals matched (amount, date window, company
  // name, reference id) and the tier that count maps to:
  // 1 weak · 2 medium · 3 strong · 4 very_strong.
  signals: integer("signals").notNull().default(1),
  strength: text("strength").notNull().default("weak"),
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  // 'suggested' | 'confirmed' | 'rejected'
  state: text("state").notNull().default("suggested"),
  decidedBy: integer("decided_by"),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Single-row mailbox connection state. Password encrypted at the app layer
// (AES-256-GCM) — Railway volume backups copy the DB, so never plaintext.
export const finMailboxTable = pgTable("fin_mailbox", {
  id: serial("id").primaryKey(),
  emailAddress: text("email_address").notNull(),
  imapHost: text("imap_host").notNull().default("imap.one.com"),
  passwordEnc: text("password_enc").notNull(),
  foldersWatched: jsonb("folders_watched").$type<string[]>().notNull().default(["INBOX"]),
  uidState: jsonb("uid_state").$type<Record<string, { uidvalidity: number; uidnext: number }>>().notNull().default({}),
  scanSince: date("scan_since"), // backfill horizon
  lastSyncAt: timestamp("last_sync_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type FinVendor = typeof finVendorsTable.$inferSelect;
export type FinLine = typeof finLinesTable.$inferSelect;
export type FinDocument = typeof finDocumentsTable.$inferSelect;
export type FinEmailIndexRow = typeof finEmailIndexTable.$inferSelect;
export type FinMatch = typeof finMatchesTable.$inferSelect;
export type FinMailbox = typeof finMailboxTable.$inferSelect;

// Read-only QuickBooks connection (single row). Tokens encrypted at the
// app layer; refresh tokens rotate ~daily so pairs persist atomically.
export const finQboConnectionTable = pgTable("fin_qbo_connection", {
  id: serial("id").primaryKey(),
  realmId: text("realm_id").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  accessExpiresAt: timestamp("access_expires_at"),
  refreshExpiresAt: timestamp("refresh_expires_at"),
  syncCursor: timestamp("sync_cursor"),
  lastSyncAt: timestamp("last_sync_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Mirror of posted QuickBooks purchases/bills, for line matching + audit.
export const finQboTxnsTable = pgTable("fin_qbo_txns", {
  id: serial("id").primaryKey(),
  qboId: text("qbo_id").notNull(),
  entityType: text("entity_type").notNull(),
  txnDate: date("txn_date"),
  totalAmt: numeric("total_amt", { precision: 12, scale: 2 }),
  vendorName: text("vendor_name"),
  docNumber: text("doc_number"),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
});

export type FinQboConnection = typeof finQboConnectionTable.$inferSelect;
export type FinQboTxn = typeof finQboTxnsTable.$inferSelect;
