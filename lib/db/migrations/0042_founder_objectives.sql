-- Founder objectives — the top of the Founder Focus goal pyramid
-- (2026-08-03, Graeme): Moonshot (10-year goal) → Mission (3–5 years) →
-- Stepping Stones (next ~3 months, measurable — e.g. "£120k/month minimum
-- Shopify revenue"). These sit above pillars/goals on /founder/focus and
-- feed the AI replan prompt so daily prioritisation is pulled by the
-- long-term targets, not just the week's template.
--
-- horizon: 'moonshot' | 'mission' | 'stepping_stone'. Moonshot and mission
-- are effectively singletons (UI edits in place); stepping stones are a
-- short list with an optional metric and target date, tickable when hit.
--
-- Applied idempotently at API startup (runStartupMigrations).

CREATE TABLE IF NOT EXISTS founder_objectives (
  id SERIAL PRIMARY KEY,
  horizon TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  metric TEXT,
  target_date DATE,
  sort INTEGER NOT NULL DEFAULT 0,
  achieved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
