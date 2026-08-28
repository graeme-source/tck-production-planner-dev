-- Curiosity Time — Lean Made Simple step 5 ("Teach Your People To See
-- Waste") made a daily habit. A team member takes a slow walk round their
-- area with the iPad, goes through the 8 wastes one at a time, marks
-- whether they can see each one happening, and snaps a photo when they can.
--
-- One walk per station per plan (same once-a-day semantics as a checklist
-- completion); one observation row per waste per walk. The waste names
-- stored here are the canonical Lean Made Simple names from
-- lib/lean-corpus.ts — the API validates them on write, so the column
-- doesn't need a CHECK that would go stale if the corpus is ever corrected.
--
-- Photos are stored inline as bytea, same as meeting-slide photos and
-- improvement media: a handful of images a day, and object storage isn't
-- wired up for this app yet.

CREATE TABLE IF NOT EXISTS curiosity_walks (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
  station_type TEXT NOT NULL,
  started_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  started_by_name TEXT NOT NULL,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_curiosity_walk UNIQUE (plan_id, station_type)
);

CREATE TABLE IF NOT EXISTS curiosity_observations (
  id SERIAL PRIMARY KEY,
  walk_id INTEGER NOT NULL REFERENCES curiosity_walks(id) ON DELETE CASCADE,
  waste_name TEXT NOT NULL,
  spotted BOOLEAN NOT NULL,
  note TEXT,
  photo BYTEA,
  photo_mime TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_curiosity_observation UNIQUE (walk_id, waste_name)
);

CREATE INDEX IF NOT EXISTS idx_curiosity_observations_walk
  ON curiosity_observations(walk_id);
