/**
 * Customer surveys — test-product feedback collected on the Shopify site.
 *
 * The admin builds a survey in the planner (questions optionally attached to
 * a recipe), then shares a link/QR to the Shopify feedback page. The public
 * widget fetches the survey by its unguessable token and posts responses —
 * no account, no session. Dedupe is soft: the widget generates a client_id
 * (localStorage) and the API refuses a second response from the same
 * client_id for the same survey. That stops accidental double-taps, not a
 * determined ballot-stuffer — acceptable for "which calzone should we
 * launch?" stakes.
 */
import { pgTable, serial, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { recipesTable } from "./recipes";

export const surveysTable = pgTable("surveys", {
  id: serial("id").primaryKey(),
  // >=24 url-safe chars, generated server-side. The token IS the access
  // control on the public API, so it must be unguessable — never sequential.
  token: text("token").notNull().unique(),
  title: text("title").notNull(),
  intro: text("intro"),
  // draft = invisible to the public API (404), open = accepting responses,
  // closed = readable (widget shows "closed") but rejects new responses.
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const surveyQuestionsTable = pgTable("survey_questions", {
  id: serial("id").primaryKey(),
  surveyId: integer("survey_id").notNull().references(() => surveysTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  // 'rating' | 'slider' | 'choice' | 'multi' | 'text' | 'rank'
  // slider = 0-100 approval %, added for the Shopify widget's granular scale.
  type: text("type").notNull(),
  prompt: text("prompt").notNull(),
  // Optional link to a recipe — the public survey shows the recipe's name and
  // Shopify image above the question. set null on recipe delete: the question
  // survives as a plain question rather than dying with the recipe.
  recipeId: integer("recipe_id").references(() => recipesTable.id, { onDelete: "set null" }),
  // choice/multi/rank: array of option strings. Null for rating/text.
  options: jsonb("options"),
  required: boolean("required").notNull().default(true),
  // Rating scale ceiling (stars). Ignored by the other types.
  max: integer("max").notNull().default(5),
}, (t) => ({
  surveyIdx: index("ix_survey_questions_survey").on(t.surveyId),
}));

export const surveyResponsesTable = pgTable("survey_responses", {
  id: serial("id").primaryKey(),
  surveyId: integer("survey_id").notNull().references(() => surveysTable.id, { onDelete: "cascade" }),
  // Browser-generated id (localStorage) — the soft-dedupe key, not identity.
  clientId: text("client_id").notNull(),
  userAgent: text("user_agent"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
}, (t) => ({
  // One response per browser per survey — enforced at the DB so two racing
  // submits can't both land.
  clientDedupe: uniqueIndex("ux_survey_responses_survey_client").on(t.surveyId, t.clientId),
}));

export const surveyAnswersTable = pgTable("survey_answers", {
  id: serial("id").primaryKey(),
  responseId: integer("response_id").notNull().references(() => surveyResponsesTable.id, { onDelete: "cascade" }),
  questionId: integer("question_id").notNull().references(() => surveyQuestionsTable.id, { onDelete: "cascade" }),
  // Shape depends on question type: rating -> number, choice -> string,
  // multi -> string[], text -> string, rank -> string[] in ranked order.
  value: jsonb("value").notNull(),
}, (t) => ({
  responseIdx: index("ix_survey_answers_response").on(t.responseId),
  questionIdx: index("ix_survey_answers_question").on(t.questionId),
}));

export type Survey = typeof surveysTable.$inferSelect;
export type SurveyQuestion = typeof surveyQuestionsTable.$inferSelect;
export type SurveyResponse = typeof surveyResponsesTable.$inferSelect;
export type SurveyAnswer = typeof surveyAnswersTable.$inferSelect;

export const SURVEY_QUESTION_TYPES = ["rating", "slider", "choice", "multi", "text", "rank"] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];
