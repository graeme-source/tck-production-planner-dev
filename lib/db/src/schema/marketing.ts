import { pgTable, serial, text, integer, timestamp, date, jsonb, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { testBoxesTable } from "./test_boxes";

// Marketing calendar (migrations 0043 + 0135). Planned together by the
// founder and the marketing team on the Sales & Marketing page. Column names
// predate the calendar: `name` is the event title, `offer` the offer details,
// `notes` the long notes, `source` 'manual' | 'ai' (who suggested it).
export const marketingEventsTable = pgTable("marketing_events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  summary: text("summary"),
  offer: text("offer"),
  notes: text("notes"),
  // campaign | email | offer | product_launch | seasonal | test_box | other
  eventType: text("event_type").notNull().default("campaign"),
  channels: text("channels").array().notNull().default(sql`'{}'::text[]`),
  audience: text("audience"),
  // idea | planned | live | done
  status: text("status").notNull().default("planned"),
  source: text("source").notNull().default("manual"),
  // Set on a test box's own event (migration 0136); dates follow the box.
  testBoxId: integer("test_box_id").references(() => testBoxesTable.id, { onDelete: "set null" }),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedById: integer("deleted_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  deletedByName: text("deleted_by_name"),
});

export const marketingEventHistoryTable = pgTable("marketing_event_history", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => marketingEventsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name"),
  // created | edited | moved | resized | deleted
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  changes: jsonb("changes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type MarketingEvent = typeof marketingEventsTable.$inferSelect;
export type MarketingEventHistory = typeof marketingEventHistoryTable.$inferSelect;

// Planned emails (migration 0137). Each belongs to a campaign automatically
// by date — the marketing_events row whose dates contain send_date (rule in
// @workspace/marketing-calendar campaignForDate). Membership is never stored.
export const marketingEmailsTable = pgTable("marketing_emails", {
  id: serial("id").primaryKey(),
  sendDate: date("send_date").notNull(),
  // "HH:MM" London time, optional.
  sendTime: text("send_time"),
  subject: text("subject").notNull(),
  offer: text("offer"),
  coreMessage: text("core_message"),
  smsSuggestion: text("sms_suggestion"),
  cadence: text("cadence"),
  // all | new | returning | vip | lapsed
  audiences: text("audiences").array().notNull().default(sql`'{}'::text[]`),
  audienceOther: text("audience_other"),
  websiteChange: text("website_change"),
  metaChange: text("meta_change"),
  notes: text("notes"),
  // The STAGE (migration 0138): planned | created | scheduled | sent.
  // Manual while unlinked; once linked to Klaviyo the stage shown is
  // derived from Klaviyo (effectiveStage in @workspace/marketing-calendar).
  status: text("status").notNull().default("planned"),
  klaviyoCampaignId: text("klaviyo_campaign_id"),
  klaviyoCampaignName: text("klaviyo_campaign_name"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedById: integer("deleted_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  deletedByName: text("deleted_by_name"),
});

export const marketingEmailHistoryTable = pgTable("marketing_email_history", {
  id: serial("id").primaryKey(),
  emailId: integer("email_id").notNull().references(() => marketingEmailsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name"),
  // created | edited | moved | linked | unlinked | deleted | approved | unapproved
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  changes: jsonb("changes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type MarketingEmail = typeof marketingEmailsTable.$inferSelect;
export type MarketingEmailHistory = typeof marketingEmailHistoryTable.$inferSelect;

// Approvals (migration 0138). ONE row per approvable thing, keyed by
// target_key: 'plan:<id>' for a planned email not linked to Klaviyo, or
// 'klaviyo:<campaign id>' for a Klaviyo campaign (on its own, or the one a
// plan is linked to — they share this row). Key rule: approvalKey() in
// @workspace/marketing-calendar. The snapshot columns are as at approval.
export const marketingEmailApprovalsTable = pgTable("marketing_email_approvals", {
  id: serial("id").primaryKey(),
  targetKey: text("target_key").notNull().unique(),
  emailId: integer("email_id").references(() => marketingEmailsTable.id, { onDelete: "set null" }),
  klaviyoCampaignId: text("klaviyo_campaign_id"),
  approved: boolean("approved").notNull().default(false),
  subject: text("subject"),
  klaviyoCampaignName: text("klaviyo_campaign_name"),
  sendDate: date("send_date"),
  approvedById: integer("approved_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  approvedByName: text("approved_by_name"),
  approvedAt: timestamp("approved_at"),
  unapprovedById: integer("unapproved_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  unapprovedByName: text("unapproved_by_name"),
  unapprovedAt: timestamp("unapproved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const marketingEmailApprovalHistoryTable = pgTable("marketing_email_approval_history", {
  id: serial("id").primaryKey(),
  approvalId: integer("approval_id").notNull().references(() => marketingEmailApprovalsTable.id, { onDelete: "cascade" }),
  // approved | unapproved | moved
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  subject: text("subject"),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type MarketingEmailApproval = typeof marketingEmailApprovalsTable.$inferSelect;
