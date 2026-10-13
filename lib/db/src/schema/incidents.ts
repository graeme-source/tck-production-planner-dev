import { pgTable, serial, text, timestamp, boolean, integer, customType, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Accident & incident diary for HACCP due diligence (Graeme, 2026-09-11:
// the broken oven-door glass — document the incident, the containment, the
// food thrown away and the clean-down, and sign it, all in one place).
// One row per report; free-text fields autosave from the diary UI and the
// standard containment steps are explicit booleans so the diary can show
// due diligence at a glance.
export const incidentReportsTable = pgTable("incident_reports", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull().default("incident"), // 'accident' | 'incident' | 'near_miss'
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  title: text("title").notNull().default(""),
  location: text("location"),
  description: text("description"),
  peopleInvolved: text("people_involved"),
  injuries: text("injuries"),
  foodSafetyImpact: text("food_safety_impact"),
  immediateActions: text("immediate_actions"),
  correctiveActions: text("corrective_actions"),
  productionStopped: boolean("production_stopped").notNull().default(false),
  foodDiscarded: boolean("food_discarded").notNull().default(false),
  riskAssessmentDone: boolean("risk_assessment_done").notNull().default(false),
  areaCleaned: boolean("area_cleaned").notNull().default(false),
  status: text("status").notNull().default("open"), // 'open' | 'closed'
  reportedByUserId: integer("reported_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reportedByName: text("reported_by_name"),
  signedByUserId: integer("signed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  signedByName: text("signed_by_name"),
  signedAt: timestamp("signed_at"),
  // Lock & unlock (migration 0190, Graeme 2026-10-13). Each signature is a
  // version; a signed report is read-only until a manager unlocks it with
  // a reason, and signing again re-locks it. Rules:
  // api-server/src/lib/incident-lock-rules.ts.
  signedVersion: integer("signed_version").notNull().default(0),
  unlockedAt: timestamp("unlocked_at"),
  unlockedByUserId: integer("unlocked_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  unlockedByName: text("unlocked_by_name"),
  unlockReason: text("unlock_reason"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type IncidentReport = typeof incidentReportsTable.$inferSelect;

// Signature and unlock history (migration 0190): 'signed' rows keep a JSON
// snapshot of each signed version, 'unlocked' rows keep who/when/why. Never
// deleted, so the original signed wording is always on record.
export const incidentReportHistoryTable = pgTable("incident_report_history", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull().references(() => incidentReportsTable.id, { onDelete: "restrict" }),
  event: text("event").notNull(), // 'signed' | 'unlocked'
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  actorName: text("actor_name"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IncidentReportHistory = typeof incidentReportHistoryTable.$inferSelect;

// Photos / short videos on a report (migration 0188, Graeme 2026-10-13: a
// foreign-object report needed its photo). HACCP evidence, so a row is
// never hard-deleted: "remove" stamps deleted_at/by/reason and keeps the
// bytes. added_after_signing is fixed at upload from the report's
// signed_at; an upload never touches the signed report row itself.
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const incidentAttachmentsTable = pgTable("incident_attachments", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull().references(() => incidentReportsTable.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(), // 'image' | 'video'
  mime: text("mime").notNull(),
  data: bytea("data").notNull(),
  fileName: text("file_name"),
  sizeBytes: integer("size_bytes"),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  uploadedByName: text("uploaded_by_name"),
  addedAfterSigning: boolean("added_after_signing").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByUserId: integer("deleted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  deletedByName: text("deleted_by_name"),
  deleteReason: text("delete_reason"),
});

export type IncidentAttachment = typeof incidentAttachmentsTable.$inferSelect;
