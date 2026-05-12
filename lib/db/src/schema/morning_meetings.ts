/**
 * Morning Meeting feature (Paul Akers' Two Second Lean — daily 10-15 min
 * stand-up that surfaces struggles, teaches one lean concept, and ends
 * with gratitude). The slideshow itself is generated from existing data
 * (production plan, deliveries, wonky/builder/packing KPIs from
 * batch_completions, etc.) — these tables only persist what isn't
 * already recoverable from elsewhere:
 *   - which meeting happened on which day and who hosted
 *   - the rolling lean curriculum (12 weekly topics that repeat)
 *   - per-meeting gratitude shout-outs (don't fit improvements/andons)
 *
 * Safety issues + struggles raised during the meeting are written into
 * the existing `andon_issues` and `improvement_submissions` tables so
 * they show up on the existing kaizen / problem-log boards instead of
 * being siloed here.
 */
import { pgTable, serial, text, integer, timestamp, boolean, date, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";

export const leanLessonsTable = pgTable("lean_lessons", {
  id: serial("id").primaryKey(),
  // 1-12 maps to the 12-week rolling curriculum; today's lesson is
  // resolved by (week_of_year % 12) + 1 so the curriculum repeats once
  // a year automatically. Admin can override per week if they want.
  weekNumber: integer("week_number").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  // Prep-mode pages — the three-step "teach the teacher" walkthrough
  // shown to the host before they start the meeting. Markdown.
  explanationMd: text("explanation_md").notNull(),     // page 1: what it means
  whatToShowMd: text("what_to_show_md").notNull(),     // page 2: what the team sees
  deliveryNotesMd: text("delivery_notes_md").notNull(), // page 3: how to present
  // YouTube / Loom link, optional, embedded on the team slide
  videoUrl: text("video_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_lean_lesson_week").on(table.weekNumber),
]);

export const morningMeetingsTable = pgTable("morning_meetings", {
  id: serial("id").primaryKey(),
  meetingDate: date("meeting_date").notNull(),
  hostUserId: integer("host_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  hostName: text("host_name"),
  // Snapshot of which lesson was presented so a later edit to the
  // curriculum doesn't rewrite history.
  lessonId: integer("lesson_id").references(() => leanLessonsTable.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
}, (table) => [
  unique("uq_morning_meeting_date").on(table.meetingDate),
]);

export const meetingGratitudeTable = pgTable("meeting_gratitude", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull().references(() => morningMeetingsTable.id, { onDelete: "cascade" }),
  fromName: text("from_name").notNull(),
  toName: text("to_name"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLeanLessonSchema = createInsertSchema(leanLessonsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMorningMeetingSchema = createInsertSchema(morningMeetingsTable).omit({ id: true, startedAt: true });
export const insertMeetingGratitudeSchema = createInsertSchema(meetingGratitudeTable).omit({ id: true, createdAt: true });

export type LeanLesson = typeof leanLessonsTable.$inferSelect;
export type MorningMeeting = typeof morningMeetingsTable.$inferSelect;
export type MeetingGratitude = typeof meetingGratitudeTable.$inferSelect;
