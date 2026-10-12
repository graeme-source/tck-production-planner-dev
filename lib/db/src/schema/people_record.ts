import { pgTable, serial, text, integer, timestamp, boolean, date } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// The employment record — classified entries (migration 0170). Rules + tests
// in lib/people-reviews; API routes/people-reviews.ts (private People PIN,
// founder or People-data grant and never your own record, every read and
// write audited).

/** Editable list; field_sets switch on the extra fields (data, not names). */
export const peopleRecordClassificationsTable = pgTable("people_record_classifications", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Any of: stage, rating, pay, probation, fitness */
  fieldSets: text("field_sets").array().notNull().default([]),
  /** attendance | timekeeping */
  evidence: text("evidence"),
  active: boolean("active").notNull().default(true),
  /** What a newly scheduled meeting starts as when nobody picks (0182). */
  defaultForMeetings: boolean("default_for_meetings").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** The stage ladder (seeded informal discussion → dismissal). */
export const peopleReviewStagesTable = pgTable("people_review_stages", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  rank: integer("rank").notNull(),
  /** discussion | plan | warning | outcome */
  type: text("type").notNull(),
  formal: boolean("formal").notNull().default(false),
  defaultExpiryMonths: integer("default_expiry_months"),
  optional: boolean("optional").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const peopleRecordEntriesTable = pgTable("people_record_entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  classificationId: integer("classification_id").notNull().references(() => peopleRecordClassificationsTable.id),
  entryDate: date("entry_date").notNull().defaultNow(),
  title: text("title").notNull().default(""),
  notes: text("notes"),
  notesUpdatedByName: text("notes_updated_by_name"),
  notesUpdatedAt: timestamp("notes_updated_at"),
  /** open = "Open — in review" | closed */
  status: text("status").notNull().default("closed"),
  closedOn: date("closed_on"),
  reviewStart: date("review_start"),
  reviewEnd: date("review_end"),
  outcome: text("outcome"),
  nextReviewDate: date("next_review_date"),
  reviewTodoId: integer("review_todo_id"),
  stageId: integer("stage_id").references(() => peopleReviewStagesTable.id, { onDelete: "set null" }),
  warningExpiresOn: date("warning_expires_on"),
  warningWithdrawnAt: timestamp("warning_withdrawn_at"),
  warningWithdrawnReason: text("warning_withdrawn_reason"),
  rating: text("rating"),
  payFrom: text("pay_from"),
  payTo: text("pay_to"),
  payEffectiveOn: date("pay_effective_on"),
  probationOutcome: text("probation_outcome"),
  probationNewEnd: date("probation_new_end"),
  fitForWork: text("fit_for_work"),
  meetingType: text("meeting_type"),
  meetingDate: date("meeting_date"),
  meetingTime: text("meeting_time"),
  meetingAttendees: text("meeting_attendees"),
  meetingChecklist: text("meeting_checklist").array().notNull().default([]),
  meetingTodoId: integer("meeting_todo_id"),
  /** The review itself (migration 0178): booked | held | cancelled. NULL =
   *  no meeting, just on the record. meeting_type is an optional detail. */
  meetingStatus: text("meeting_status"),
  heldAt: timestamp("held_at"),
  /** Which attendance trigger this review deals with (migration 0183):
   *  sickness | lates | both | none. NULL = automatic, by the
   *  classification's attendance evidence (policy-trigger.ts). */
  answersTrigger: text("answers_trigger"),
  /** The old employee_meetings row this came from (0178), if any. */
  legacyMeetingId: integer("legacy_meeting_id"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** A review's write-up (migration 0178): feedback, objectives and notes,
 *  each PRIVATE to its author until shared with the employee. Who may read
 *  which is decided on the server by employee-review-visibility.ts. entry_id
 *  NULL = a loose note from the old diary. Never hard-deleted. */
export const peopleReviewNotesTable = pgTable("people_review_notes", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id").references(() => peopleRecordEntriesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /** note | feedback | objective */
  kind: text("kind").notNull().default("note"),
  title: text("title"),
  body: text("body").notNull(),
  /** private | shared */
  visibility: text("visibility").notNull().default("private"),
  sharedAt: timestamp("shared_at"),
  dueDate: date("due_date"),
  doneAt: timestamp("done_at"),
  authorId: integer("author_id").references(() => usersTable.id, { onDelete: "set null" }),
  authorName: text("author_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  legacyNoteId: integer("legacy_note_id"),
});

export type PeopleReviewNote = typeof peopleReviewNotesTable.$inferSelect;

/** The meeting notes an AI draft was made from (migration 0182): the shared
 *  link, if any, and the raw text — kept for audit, People access only. */
export const peopleRecordEntrySourcesTable = pgTable("people_record_entry_sources", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id").notNull().references(() => peopleRecordEntriesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /** url | text */
  kind: text("kind").notNull(),
  sourceUrl: text("source_url"),
  rawText: text("raw_text").notNull(),
  model: text("model"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Every read and write, and each entry's history. Append-only. */
export const peopleRecordAuditTable = pgTable("people_record_audit", {
  id: serial("id").primaryKey(),
  viewerId: integer("viewer_id").references(() => usersTable.id, { onDelete: "set null" }),
  viewerName: text("viewer_name"),
  subjectUserId: integer("subject_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  entryId: integer("entry_id").references(() => peopleRecordEntriesTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  detail: text("detail"),
  at: timestamp("at").notNull().defaultNow(),
});

export type PeopleRecordEntry = typeof peopleRecordEntriesTable.$inferSelect;

/** Letter templates — founder-editable; when each is offered is data. */
export const peopleLetterTemplatesTable = pgTable("people_letter_templates", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  fieldSet: text("field_set"),
  stageId: integer("stage_id").references(() => peopleReviewStagesTable.id, { onDelete: "set null" }),
  stageType: text("stage_type"),
  probationOutcome: text("probation_outcome"),
  requiresMeeting: boolean("requires_meeting").notNull().default(false),
  requiresPay: boolean("requires_pay").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** HR settings — one row (id 1): who letter emails come from (NULL = the
 *  default) and the Needs-attention lead times. */
export const peopleHrSettingsTable = pgTable("people_hr_settings", {
  id: integer("id").primaryKey().default(1),
  fromName: text("from_name"),
  fromLocal: text("from_local"),
  replyTo: text("reply_to"),
  probationDays: integer("probation_days").notNull().default(14),
  reviewDays: integer("review_days").notNull().default(7),
  warningDays: integer("warning_days").notNull().default(14),
  updatedByName: text("updated_by_name"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** A letter made from an entry: draft → filed → sent → read → acknowledged. */
export const peopleLettersTable = pgTable("people_letters", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id").notNull().references(() => peopleRecordEntriesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  templateId: integer("template_id").references(() => peopleLetterTemplatesTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  /** draft | filed | sent */
  status: text("status").notNull().default("draft"),
  signatoryName: text("signatory_name"),
  documentId: integer("document_id"),
  filedAt: timestamp("filed_at"),
  sentAt: timestamp("sent_at"),
  sentByName: text("sent_by_name"),
  emailedTo: text("emailed_to"),
  emailedAt: timestamp("emailed_at"),
  readAt: timestamp("read_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Probation per person: start → end, outcome once decided. */
export const peopleProbationTable = pgTable("people_probation", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  /** passed | not_passed */
  outcome: text("outcome"),
  decidedOn: date("decided_on"),
  updatedByName: text("updated_by_name"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
