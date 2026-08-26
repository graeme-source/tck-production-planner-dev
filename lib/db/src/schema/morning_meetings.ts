/**
 * Morning Meeting feature (Paul Akers' Two Second Lean — daily 10-15 min
 * stand-up that surfaces struggles, teaches one lean concept, and ends
 * with gratitude).
 *
 * Phase-1 evolution: meetings used to render from a hardcoded 12-slide
 * array on the frontend. Now there's a `meeting_templates` table with
 * ordered `template_slides`, and each scheduled meeting copies those
 * slides into its own `meeting_slides` row set so hosts can edit a
 * given day's run without affecting the master.
 *
 * Curriculum also splits into two levels:
 *   - `lean_principles`  — the weekly theme (e.g. "3S — visual workplace")
 *   - `lean_examples`    — daily angles on that principle (Mon/Tue/Wed…)
 * Today's lesson defaults to the day-of-week's example under this
 * week's principle. Host can override via a dropdown on the slide.
 *
 * Legacy `lean_lessons` table is kept for safety during the migration
 * window — backfilled into the new principle/example tables on
 * startup, then made read-only.
 */
import { pgTable, serial, text, integer, timestamp, boolean, date, unique, jsonb, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";

// ── Curriculum: principles → examples ───────────────────────────────

// The backlog of lean subjects to teach — the library the curriculum is
// built FROM (migration 0057). Seeded from the verified corpus
// (api-server/src/lib/lean-corpus.ts) and extended by hand in the planner.
// `audience` separates what a team member needs to learn ('team') from the
// owner-facing transformation steps ('leaders'), which stay out of the
// team curriculum by default.
export const leanSubjectsTable = pgTable("lean_subjects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  nutshell: text("nutshell").notNull(),
  // 'waste' | 'concept' | 'step' | 'custom' — lets a corpus re-seed top up
  // without disturbing hand-added subjects.
  source: text("source").notNull().default("custom"),
  audience: text("audience").notNull().default("team"),
  // Typical length, and the per-week part names when a subject splits over
  // several weeks (3S → an overview week, then Sweep / Sort / Standardise).
  defaultWeeks: integer("default_weeks").notNull().default(1),
  suggestedParts: jsonb("suggested_parts").$type<string[] | null>(),
  sortOrder: integer("sort_order").notNull().default(0),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const leanPrinciplesTable = pgTable("lean_principles", {
  id: serial("id").primaryKey(),
  // 1-N. Today's principle is the one at (week_of_year % count) + 1.
  // Admin can reorder by changing this value; gaps are fine.
  weekPosition: integer("week_position").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  // Which backlog subject this week teaches, and which slice of it
  // (migration 0057). partLabel null = the subject's own/overview week.
  subjectId: integer("subject_id").references(() => leanSubjectsTable.id, { onDelete: "set null" }),
  partLabel: text("part_label"),
  partIndex: integer("part_index"),
  // 'draft' while the week's lessons are being written and reviewed,
  // 'locked' once signed off. Only locked weeks reach the team.
  status: text("status").notNull().default("locked"),
  // The week's review quiz: JSON array of { question, options[], answer }
  // authored with the curriculum (migration 0055). Null = no quiz, the
  // weekly review completes without one.
  quizJson: text("quiz_json"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_lean_principle_week").on(table.weekPosition),
]);

// One row per person per week: they completed the week's lesson module
// (pages + quiz). Feeds the Lean training matrix auto-tick and the weekly
// to-do close-out (migration 0055).
export const leanLessonReviewsTable = pgTable("lean_lesson_reviews", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  principleId: integer("principle_id").notNull().references(() => leanPrinciplesTable.id, { onDelete: "cascade" }),
  weekStart: date("week_start").notNull(),
  quizCorrect: integer("quiz_correct"),
  quizTotal: integer("quiz_total"),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_lean_review_user_week").on(table.userId, table.weekStart),
]);

export const leanExamplesTable = pgTable("lean_examples", {
  id: serial("id").primaryKey(),
  principleId: integer("principle_id").notNull().references(() => leanPrinciplesTable.id, { onDelete: "cascade" }),
  // Sort order within a principle. Today's example defaults to the
  // example at (current weekday Mon=1..Fri=5) clamped to the count.
  orderPosition: integer("order_position").notNull().default(0),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  // Three markdown blocks for the teach-the-teacher prep mode + the
  // slide itself. Same shape the slideshow rendered before.
  explanationMd: text("explanation_md").notNull(),
  whatToShowMd: text("what_to_show_md").notNull(),
  deliveryNotesMd: text("delivery_notes_md").notNull(),
  videoUrl: text("video_url"),
  // Optional engagement media for the slide. `diagram` is a key into a
  // bank of code-drawn SVG visuals (e.g. "compound-growth", "eight-wastes",
  // "3s-cycle"); `imageUrl` is an optional photograph to show alongside.
  diagram: text("diagram"),
  imageUrl: text("image_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Legacy table — kept during migration so old morning_meetings rows
// still resolve. New code points at leanExamplesTable instead.
export const leanLessonsTable = pgTable("lean_lessons", {
  id: serial("id").primaryKey(),
  weekNumber: integer("week_number").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  explanationMd: text("explanation_md").notNull(),
  whatToShowMd: text("what_to_show_md").notNull(),
  deliveryNotesMd: text("delivery_notes_md").notNull(),
  videoUrl: text("video_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_lean_lesson_week").on(table.weekNumber),
]);

// ── Templates + slides ──────────────────────────────────────────────

export const meetingTemplatesTable = pgTable("meeting_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // The one row with isDefault=true is the master template that new
  // meetings clone from. Future: per-day-of-week templates.
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const templateSlidesTable = pgTable("template_slides", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => meetingTemplatesTable.id, { onDelete: "cascade" }),
  // Slide type — drives which renderer + data source the runner uses.
  // See SLIDE_KIND_CATALOG on the server for the full list.
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  orderPosition: integer("order_position").notNull().default(0),
  contentMd: text("content_md"),
  // Optional kind-specific config. For yesterday_kpis it's the list of
  // KPIs to show. For lesson, it's an override exampleId. Stored as
  // JSON so we don't need a column per knob.
  configJson: jsonb("config_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ── Per-meeting state ───────────────────────────────────────────────

// Postgres `bytea` — stored / returned as a Buffer (same pattern as
// risk_assessments / onboarding). Used for the optional gratitude-slide photo.
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const morningMeetingsTable = pgTable("morning_meetings", {
  id: serial("id").primaryKey(),
  meetingDate: date("meeting_date").notNull(),
  hostUserId: integer("host_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  hostName: text("host_name"),
  // Legacy reference for backwards compat. New code reads
  // meeting_slides[kind='lesson'].config_json.exampleId.
  lessonId: integer("lesson_id"),
  // Pointer to the example that was picked for the lesson slide.
  exampleId: integer("example_id").references(() => leanExamplesTable.id, { onDelete: "set null" }),
  // Optional photo + caption shown on the closing gratitude slide. Stored
  // per-meeting (i.e. fresh each day) inline as bytea — no object storage
  // needed. When absent, the slide falls back to a live themed image.
  gratitudePhoto: bytea("gratitude_photo"),
  gratitudePhotoMime: text("gratitude_photo_mime"),
  gratitudeCaption: text("gratitude_caption"),
  // Names of anyone in on a trial shift today, typed by the presenter on
  // the setup screen; the opening slide shows a welcome only when set
  // (migration 0056).
  trialWelcome: text("trial_welcome"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
}, (table) => [
  unique("uq_morning_meeting_date").on(table.meetingDate),
]);

export const meetingSlidesTable = pgTable("meeting_slides", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull().references(() => morningMeetingsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  orderPosition: integer("order_position").notNull().default(0),
  contentMd: text("content_md"),
  configJson: jsonb("config_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const meetingGratitudeTable = pgTable("meeting_gratitude", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull().references(() => morningMeetingsTable.id, { onDelete: "cascade" }),
  fromName: text("from_name").notNull(),
  toName: text("to_name"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Insert schemas / types ──────────────────────────────────────────

export const insertLeanPrincipleSchema = createInsertSchema(leanPrinciplesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLeanExampleSchema = createInsertSchema(leanExamplesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLeanLessonSchema = createInsertSchema(leanLessonsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMeetingTemplateSchema = createInsertSchema(meetingTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTemplateSlideSchema = createInsertSchema(templateSlidesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMorningMeetingSchema = createInsertSchema(morningMeetingsTable).omit({ id: true, startedAt: true });
export const insertMeetingSlideSchema = createInsertSchema(meetingSlidesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMeetingGratitudeSchema = createInsertSchema(meetingGratitudeTable).omit({ id: true, createdAt: true });

export type LeanSubject = typeof leanSubjectsTable.$inferSelect;
export type LeanPrinciple = typeof leanPrinciplesTable.$inferSelect;
export type LeanExample = typeof leanExamplesTable.$inferSelect;
export type LeanLesson = typeof leanLessonsTable.$inferSelect;
export type MeetingTemplate = typeof meetingTemplatesTable.$inferSelect;
export type TemplateSlide = typeof templateSlidesTable.$inferSelect;
export type MorningMeeting = typeof morningMeetingsTable.$inferSelect;
export type MeetingSlide = typeof meetingSlidesTable.$inferSelect;
export type MeetingGratitude = typeof meetingGratitudeTable.$inferSelect;
