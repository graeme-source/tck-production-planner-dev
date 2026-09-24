import { pgTable, serial, text, timestamp, boolean, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { andonIssuesTable } from "./improvements_and_andon";

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
  noGoZone: boolean("no_go_zone").notNull().default(false),
  behaviourChange: boolean("behaviour_change").notNull().default(false),
  questionForGraeme: text("question_for_graeme"),
  /** Claude's draft message to the reporter (migration 0120) — pre-fills
   *  Graeme's "Message the reporter" box. */
  suggestedReply: text("suggested_reply"),
  /** Already fixed / withdrawn / not a problem — the Fix queue offers
   *  Dismiss instead of Approve (migration 0121). */
  noActionNeeded: boolean("no_action_needed").notNull().default(false),
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

export type IssueTriage = typeof issueTriageTable.$inferSelect;
export type IssueTriageEvent = typeof issueTriageEventsTable.$inferSelect;
export type IssueFixNotice = typeof issueFixNoticesTable.$inferSelect;
