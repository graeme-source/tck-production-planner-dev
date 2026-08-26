-- Lean curriculum planner (Objective E).
--
-- Two levels already existed: lean_principles (the weekly theme) and
-- lean_examples (the five daily angles). What was missing was the layer
-- ABOVE them — a backlog of lean subjects to choose from, and the record
-- of which subject a scheduled week came from.
--
-- lean_subjects is the library: every concept we teach, drawn from the
-- verified corpus (src/lib/lean-corpus.ts) plus anything Graeme adds by
-- hand. Subjects are not scheduled — they sit in the backlog until they
-- are dragged into the curriculum, at which point one lean_principles row
-- is created per week they occupy.
--
-- `audience` is the distinction that matters for who we teach: Lean Made
-- Simple is written for business owners transforming an organisation, but
-- our curriculum is for team members learning lean inside one. Subjects
-- about setting up the transformation (Create An Example Area, Create A
-- Lean Leaders Group) are audience='leaders' and stay out of the team
-- backlog by default; the things a team member actually needs — seeing
-- waste, doing an improvement, 3S, total ownership — are audience='team'.

CREATE TABLE IF NOT EXISTS lean_subjects (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  nutshell TEXT NOT NULL,
  -- Where it came from, so a re-seed can top up without touching custom
  -- subjects: 'waste' | 'concept' | 'step' | 'custom'.
  source TEXT NOT NULL DEFAULT 'custom',
  -- 'team' (a colleague learning lean) | 'leaders' (running the transformation).
  audience TEXT NOT NULL DEFAULT 'team',
  -- How many weeks this subject usually needs, and the per-week part names
  -- when it splits (3S → Sweep / Sort / Standardise after an overview week).
  default_weeks INTEGER NOT NULL DEFAULT 1,
  suggested_parts JSONB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness so the corpus re-seed is idempotent and a
-- hand-added "3s" can't shadow the seeded "3S".
CREATE UNIQUE INDEX IF NOT EXISTS ux_lean_subjects_title ON lean_subjects (LOWER(title));
CREATE INDEX IF NOT EXISTS ix_lean_subjects_backlog ON lean_subjects (is_archived, audience, sort_order);

-- A scheduled week now knows which subject it teaches and which part of it.
-- part_label null = the subject's own week (the overview); otherwise the
-- name of this week's slice ("Sweep"). part_index is 1-based within subject.
ALTER TABLE lean_principles ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES lean_subjects(id) ON DELETE SET NULL;
ALTER TABLE lean_principles ADD COLUMN IF NOT EXISTS part_label TEXT;
ALTER TABLE lean_principles ADD COLUMN IF NOT EXISTS part_index INTEGER;

-- Authoring state. A week is 'draft' while its lessons are being generated
-- and reviewed, and 'locked' once Graeme has signed it off — the morning
-- meeting and the weekly review only ever teach locked weeks, so a
-- half-written week can sit in the plan without reaching the team.
ALTER TABLE lean_principles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'locked';

CREATE INDEX IF NOT EXISTS ix_lean_principles_subject ON lean_principles (subject_id);
