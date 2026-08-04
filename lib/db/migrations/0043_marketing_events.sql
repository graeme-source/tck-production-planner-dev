-- Sales & Marketing assistant (2026-08-03, Graeme): "we always need to have
-- something on" — a marketing calendar of named offers/events (World Cup
-- box, Black Friday, summer holiday free pack…) with a 6-week lookahead,
-- plus revenue pacing against the £120k/month stepping stone and email-
-- cadence nudges (email at least every 3 days).
--
-- marketing_events: one row per named offer/campaign window. status is
-- 'idea' (AI-suggested, not committed) or 'planned' (locked in); whether
-- it's live/past is derived from the dates. source records whether Graeme
-- or the AI created it.
--
-- Settings seeded (ON CONFLICT DO NOTHING so edits stick):
--   monthly_revenue_target        — pace target in £ (stepping stone)
--   marketing_email_cadence_days  — nudge when no email sent in N days
--
-- Applied idempotently at API startup (runStartupMigrations). Seeds the two
-- events Graeme named (summer holiday free pack now, Black Friday) once,
-- guarded by _migrations_done key 'marketing_events_seed_v1'.

CREATE TABLE IF NOT EXISTS marketing_events (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  offer TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
