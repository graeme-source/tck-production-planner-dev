import { pgTable, serial, text, timestamp, boolean, integer, jsonb, index, primaryKey, uniqueIndex, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { andonIssuesTable, improvementSubmissionsTable } from "./improvements_and_andon";

// The issue pipeline (docs/ISSUE_PIPELINE.md; migration 0119). A scheduled
// Claude Code session triages app issues from the Andon log and writes a
// recommendation here; Graeme approves or rejects it on the Fix queue page.
// One CURRENT row per andon issue; the history lives in issueTriageEventsTable.
export const issueTriageTable = pgTable("issue_triage", {
  id: serial("id").primaryKey(),
  andonIssueId: integer("andon_issue_id").notNull().references(() => andonIssuesTable.id, { onDelete: "cascade" }),
  lane: text("lane").notNull(), // defect | data_fix | understanding | improvement | needs_info | not_app
  verdictSummary: text("verdict_summary").notNull(),
  explanation: text("explanation").notNull().default(""),
  proposedFix: text("proposed_fix").notNull().default(""),
  objective: text("objective"),
  blastRadius: text("blast_radius").notNull().default("low"), // low | medium | high
  confidence: text("confidence").notNull().default("medium"), // high | medium | low
  behaviourChange: boolean("behaviour_change").notNull().default(false),
  questionForGraeme: text("question_for_graeme"),
  /** Claude's draft message to the reporter (migration 0120) — pre-fills
   *  Graeme's "Message the reporter" box. */
  suggestedReply: text("suggested_reply"),
  /** Already fixed / withdrawn / not a problem — the Fix queue offers
   *  Dismiss instead of Approve (migration 0121). */
  noActionNeeded: boolean("no_action_needed").notNull().default(false),
  /** Snoozed off To review until this moment (migration 0122). */
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  /** "Dismiss — no action" (migration 0160): out of the queue silently, never
   *  picked up by the reviewer again; restorable from "Dismissed". */
  noActionAt: timestamp("no_action_at", { withTimezone: true }),
  noActionBy: text("no_action_by"),
  noActionByUserId: integer("no_action_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  /** Graeme messaged the reporter and is waiting for their answer (migration
   *  0191). Set by "Message <name>", cleared when they reply in words (a
   *  "Got it" is only a read receipt since 21 Oct 2026), or when the card is
   *  closed. The card stays in its tab meanwhile. */
  awaitingReporterSince: timestamp("awaiting_reporter_since", { withTimezone: true }),
  /** The reporter replied in words and Graeme hasn't acted yet (migration
   *  0191). While set the card sits in To review with "<name> replied"; any
   *  action of his on the card clears it. */
  reporterReplyAt: timestamp("reporter_reply_at", { withTimezone: true }),
  /** When Graeme last read this card's conversation (migration 0210). The
   *  reporter's replies after it are unread: badge on the card, count on the
   *  Fix queue nav. Separate from reporterReplyAt so reading never moves the
   *  card. */
  founderReadAt: timestamp("founder_read_at", { withTimezone: true }),
  /** The day the fix/feature went live — the credited improvement's done date. */
  completedOn: date("completed_on"),
  /** The improvement credited to the reporter when this closed. */
  improvementId: integer("improvement_id"),
  relatedIssueIds: integer("related_issue_ids").array().notNull().default(sql`'{}'::integer[]`),
  causeTag: text("cause_tag"),
  status: text("status").notNull().default("proposed"), // proposed | approved | rejected | in_progress | fixed | wont_fix
  awaitingRetriage: boolean("awaiting_retriage").notNull().default(false),
  decidedBy: text("decided_by"),
  decidedByUserId: integer("decided_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at"),
  decisionNote: text("decision_note"),
  fixRef: text("fix_ref"),
  fixedAt: timestamp("fixed_at"),
  issueResolvedAt: timestamp("issue_resolved_at"),
  triagedAt: timestamp("triaged_at").notNull().defaultNow(),
  triagedBy: text("triaged_by").notNull().default("claude-code"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("issue_triage_issue_uq").on(t.andonIssueId),
  index("issue_triage_status_idx").on(t.status, t.triagedAt),
]);

// Append-only: every triage write, decision and status move, with the row as
// it stood afterwards. A forced re-triage never loses Graeme's decision.
export const issueTriageEventsTable = pgTable("issue_triage_events", {
  id: serial("id").primaryKey(),
  triageId: integer("triage_id").notNull().references(() => issueTriageTable.id, { onDelete: "cascade" }),
  andonIssueId: integer("andon_issue_id").notNull().references(() => andonIssuesTable.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  actor: text("actor"),
  note: text("note"),
  snapshot: jsonb("snapshot"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("issue_triage_events_triage_idx").on(t.triageId, t.createdAt),
]);

// "Your report has been fixed — please test it": the reporter's full-screen
// pop-up, queued when the fix is deployed and the issue resolved.
export const issueFixNoticesTable = pgTable("issue_fix_notices", {
  id: serial("id").primaryKey(),
  andonIssueId: integer("andon_issue_id").notNull().references(() => andonIssuesTable.id, { onDelete: "cascade" }),
  triageId: integer("triage_id").references(() => issueTriageTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  quote: text("quote").notNull(),
  /** 'fixed' = "your report has been fixed"; 'message' = a reply from Graeme. */
  kind: text("kind").notNull().default("fixed"),
  whatChanged: text("what_changed").notNull(),
  testPath: text("test_path"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
  ackAction: text("ack_action"), // test_now | later
});

/** People told about a report's progress as well as its reporter ("Keep me
 *  posted" when AI Jane found it was already reported; migration 0352). */
export const andonIssueFollowersTable = pgTable("andon_issue_followers", {
  andonIssueId: integer("andon_issue_id").notNull().references(() => andonIssuesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.andonIssueId, t.userId] })]);

/** Every check AI Jane does before an app report is filed (migration 0352). */
export const issueReportChecksTable = pgTable("issue_report_checks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name"),
  description: text("description").notNull(),
  outcome: text("outcome").notNull(), // already_possible | already_reported | new
  reply: text("reply").notNull(),
  path: text("path"),
  matchedIssueId: integer("matched_issue_id").references(() => andonIssuesTable.id, { onDelete: "set null" }),
  result: text("result"), // resolved | followed | reported
  filedIssueId: integer("filed_issue_id").references(() => andonIssuesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** AI Jane talking a report or an app idea through before it's filed
 *  (migration 0384). The summary also goes into the report's own text. */
export const reportChatsTable = pgTable("report_chats", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name"),
  kind: text("kind").notNull(), // issue | idea
  andonIssueId: integer("andon_issue_id").references(() => andonIssuesTable.id, { onDelete: "cascade" }),
  improvementId: integer("improvement_id").references(() => improvementSubmissionsTable.id, { onDelete: "cascade" }),
  original: text("original").notNull(),
  transcript: jsonb("transcript").$type<Array<{ role: "user" | "assistant"; text: string }>>().notNull(),
  brief: text("brief"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type IssueTriage = typeof issueTriageTable.$inferSelect;
export type IssueTriageEvent = typeof issueTriageEventsTable.$inferSelect;
export type IssueFixNotice = typeof issueFixNoticesTable.$inferSelect;
