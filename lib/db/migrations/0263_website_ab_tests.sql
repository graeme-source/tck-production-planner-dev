-- Website A/B tests in the planner (Graeme, 24 Oct 2026). Objective B.
--
-- "£300 is a lot to be spending on that A/B test tool ... it's missing the
-- revenue. I need to know what the revenue is." Shopify Rollouts splits
-- visitors between themes; it can't say what each side took in. Every test
-- theme now carries a small snippet (tck-theme snippets/tck-ab.liquid) that
-- stamps its theme id on the cart (cart attribute _tck_ab_theme, so each
-- order says which theme sold it) and reports visits and add-to-carts here.
--
--   ab_hits   one row per browser session per kind ('visit' | 'add_to_cart')
--             per theme — the denominator for revenue per session.
--   ab_tests  the tests: synced from Shopify Rollouts (rollout_id set) or
--             added by hand. variants = [{ label, themeId, themeName, split }].

CREATE TABLE IF NOT EXISTS ab_hits (
  id BIGSERIAL PRIMARY KEY,
  theme_id BIGINT NOT NULL,
  theme_name TEXT,
  session_id TEXT NOT NULL,
  visitor_id TEXT,
  kind TEXT NOT NULL,
  path TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ab_hits_once UNIQUE (session_id, kind, theme_id)
);
CREATE INDEX IF NOT EXISTS ab_hits_theme_at_idx ON ab_hits (theme_id, at);

CREATE TABLE IF NOT EXISTS ab_tests (
  id SERIAL PRIMARY KEY,
  rollout_id TEXT UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  started_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  concluded_at TIMESTAMPTZ,
  variants JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
