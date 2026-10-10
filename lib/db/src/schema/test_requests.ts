import { pgTable, serial, text, integer, timestamp, boolean, unique, customType } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { andonIssuesTable, improvementSubmissionsTable } from "./improvements_and_andon";

// Same inline-bytea custom type as curiosity / morning_meetings.
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

// Forced testing (migration 0159): a change someone must try for real and
// answer. Rules: api-server lib/test-request-rules.ts.
export const testRequestsTable = pgTable("test_requests", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  steps: text("steps").notNull(),
  /** In-app page for "Take me there". */
  linkPath: text("link_path"),
  /** Only ask on pages matching this ("*" = any one part of the path). */
  onlyOnPath: text("only_on_path"),
  notBefore: timestamp("not_before", { withTimezone: true }),
  /** "HH:MM" London — only ask between these times of day. */
  dailyFrom: text("daily_from"),
  dailyUntil: text("daily_until"),
  whenText: text("when_text"),
  andonIssueId: integer("andon_issue_id").references(() => andonIssuesTable.id, { onDelete: "set null" }),
  /** The improvement idea it came from (migration 0160). */
  improvementId: integer("improvement_id").references(() => improvementSubmissionsTable.id, { onDelete: "set null" }),
  /** 'person' (made on the Test requests page) | 'deploy' (machine API). */
  source: text("source").notNull().default("person"),
  fixRef: text("fix_ref"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedByName: text("closed_by_name"),
  closeNote: text("close_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const testRequestTestersTable = pgTable("test_request_testers", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => testRequestsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  isReporter: boolean("is_reporter").notNull().default(false),
  startedAt: timestamp("started_at", { withTimezone: true }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  snoozeCount: integer("snooze_count").notNull().default(0),
  /** works_easy | works_confusing | doesnt_work | cant_test */
  answer: text("answer"),
  note: text("note"),
  photoMime: text("photo_mime"),
  photo: bytea("photo"),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  /** When the card was first shown (migration 0160). */
  promptedAt: timestamp("prompted_at", { withTimezone: true }),
  /** The to-do it was put on — "I'll do it later" (migration 0160). */
  todoTaskId: integer("todo_task_id"),
}, t => [unique("test_request_testers_request_id_user_id_key").on(t.requestId, t.userId)]);

export type TestRequest = typeof testRequestsTable.$inferSelect;
export type TestRequestTester = typeof testRequestTestersTable.$inferSelect;

// Improvement ideas checked for "this is really a request to change the app"
// (migration 0160). Rules: api-server lib/improvement-app-request.ts.
export const improvementFixSuggestionsTable = pgTable("improvement_fix_suggestions", {
  id: serial("id").primaryKey(),
  improvementId: integer("improvement_id").notNull().unique().references(() => improvementSubmissionsTable.id, { onDelete: "cascade" }),
  flagged: boolean("flagged").notNull(),
  reasons: text("reasons").array().notNull().default([]),
  /** suggested | added | dismissed */
  status: text("status").notNull().default("suggested"),
  andonIssueId: integer("andon_issue_id").references(() => andonIssuesTable.id, { onDelete: "set null" }),
  decidedBy: text("decided_by"),
  decidedByUserId: integer("decided_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ImprovementFixSuggestion = typeof improvementFixSuggestionsTable.$inferSelect;
