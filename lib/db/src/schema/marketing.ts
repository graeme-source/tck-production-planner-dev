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
  // A phase's offers, as text (migration 0208). `offer` above is kept in
  // step (offers joined) for older readers.
  offers: text("offers").array().notNull().default(sql`'{}'::text[]`),
  // all | new | returning | subscription (migration 0208).
  customerGroup: text("customer_group").notNull().default("all"),
  // Palette key from @workspace/marketing-calendar phase-colours.ts
  // (migration 0209); null = the default, soft lavender.
  color: text("color"),
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

// The offer library (migration 0208, Graeme 2026-10-20): offers to pick for
// a phase. Phases hold the TEXT, so editing or deleting one here never
// changes a phase. archived = kept, not offered for new phases.
export const marketingOffersTable = pgTable("marketing_offers", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  notes: text("notes"),
  archived: boolean("archived").notNull().default(false),
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

export type MarketingOffer = typeof marketingOffersTable.$inferSelect;
export type MarketingEventHistory = typeof marketingEventHistoryTable.$inferSelect;

// ── The email plan's offer cycle (migration 0194, Graeme 2026-10-14) ─────────
// Everything the cycle uses is data, edited in the List view's "Calendar
// setup" (founder). The maths: @workspace/marketing-calendar email-cycle.ts.

/** ONE row (id = 1): cycle start Monday, weekly plan, Saturday ideas. */
export const marketingCycleSettingsTable = pgTable("marketing_cycle_settings", {
  id: integer("id").primaryKey(),
  startDate: date("start_date").notNull(),
  // 7 entries Mon..Sun: an email type or null (no email that day).
  weeklyPlan: text("weekly_plan").array().notNull(),
  // [{ idea, subject }] — rotate week by week.
  freeSlotIdeas: jsonb("free_slot_ideas").notNull().default(sql`'[]'::jsonb`),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const marketingCycleOffersTable = pgTable("marketing_cycle_offers", {
  id: serial("id").primaryKey(),
  position: integer("position").notNull().default(0),
  // Campaign-name code, e.g. "O1 Free Pack £39.95".
  code: text("code").notNull(),
  name: text("name").notNull(),
  tag: text("tag"),
  colour: text("colour").notNull().default("green"),
  featuresProduct: boolean("features_product").notNull().default(false),
  // { launch, follow_up, new_angle, last_call } subject-line ideas.
  subjects: jsonb("subjects").notNull().default(sql`'{}'::jsonb`),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const marketingCyclePausesTable = pgTable("marketing_cycle_pauses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const marketingKeyDatesTable = pgTable("marketing_key_dates", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  name: text("name").notNull(),
  big: boolean("big").notNull().default(false),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

/** Per week (its Monday): the product added that week. */
export const marketingCycleWeeksTable = pgTable("marketing_cycle_weeks", {
  weekStart: date("week_start").primaryKey(),
  product: text("product"),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
  // Email plan (migration 0194): set when this row IS a cycle slot made
  // real — one live row per slot day. See @workspace/marketing-calendar email-cycle.
  cycleDate: date("cycle_date"),
  // launch | follow_up | new_angle | last_call | free_slot | teaser | extension
  emailType: text("email_type"),
  cycleOfferId: integer("cycle_offer_id").references(() => marketingCycleOffersTable.id, { onDelete: "set null" }),
  // The suggested Klaviyo campaign name, frozen when made from a slot.
  campaignName: text("campaign_name"),
  // A cycle email someone chose not to send this week.
  skipped: boolean("skipped").notNull().default(false),
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
  // Rest of the snapshot (migration 0208): a change to any of subject,
  // preview text or send time means it needs approving again.
  previewText: text("preview_text"),
  sendAt: timestamp("send_at", { withTimezone: true }),
  // false = an older approval that snapshotted the subject only.
  snapshotFull: boolean("snapshot_full").notNull().default(false),
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
