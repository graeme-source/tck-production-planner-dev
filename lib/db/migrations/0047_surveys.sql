-- Customer surveys (2026-08-06, Graeme): test-product feedback collected on
-- the Shopify site. The planner owns the schema, admin builder, results and
-- QR codes; the public widget (tck-theme survey section) reads/writes via
-- the token-gated /api/public/surveys endpoints.
--
-- surveys.token is the ONLY access control on the public API — crypto-random,
-- >=24 url-safe chars, never sequential. status: draft (public 404) / open /
-- closed (readable, rejects new responses).
--
-- survey_questions.type: 'rating' | 'slider' | 'choice' | 'multi' | 'text' |
-- 'rank'. slider = 0-100 approval %. options JSONB = option strings for
-- choice/multi/rank. recipe_id links a question to a recipe (public payload
-- whitelisted to id/name/image_url; image via sku_barcodes title match).
--
-- survey_responses: soft dedupe on (survey_id, client_id) — client_id is a
-- browser-generated localStorage id; unique index makes racing double-taps
-- impossible rather than merely unlikely.
--
-- survey_answers.value JSONB shape depends on question type:
-- rating -> number, slider -> number 0-100, choice -> string,
-- multi -> string[], text -> string, rank -> string[] in ranked order.
--
-- Applied idempotently at API startup (runStartupMigrations); the
-- _migrations_done key 'surveys_v1' records first landing.

CREATE TABLE IF NOT EXISTS surveys (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  intro TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS survey_questions (
  id SERIAL PRIMARY KEY,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  options JSONB,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  max INTEGER NOT NULL DEFAULT 5
);
CREATE INDEX IF NOT EXISTS ix_survey_questions_survey ON survey_questions (survey_id);

CREATE TABLE IF NOT EXISTS survey_responses (
  id SERIAL PRIMARY KEY,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  user_agent TEXT,
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_survey_responses_survey_client ON survey_responses (survey_id, client_id);

CREATE TABLE IF NOT EXISTS survey_answers (
  id SERIAL PRIMARY KEY,
  response_id INTEGER NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  value JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_survey_answers_response ON survey_answers (response_id);
CREATE INDEX IF NOT EXISTS ix_survey_answers_question ON survey_answers (question_id);
