-- Club Special changeovers (Graeme, 2026-10-05). Objectives F (the rotating
-- special changes over on the website without anyone having to remember a
-- list of steps) and I (the founder schedules it once, in advance).
--
-- One row per changeover: which recipe the Calzone Club Special delivers,
-- from which DELIVERY date, and what changes with it. The app switches the
-- planner's is_current_special flag on switch_on (by default the delivery
-- date minus the subscription billing offset, so renewals billed from that
-- day carry the new recipe), then updates Shopify: the tck.current_special
-- snapshot (recipe, delivering_from, announcement, what's next), the
-- current-special product tag and, if given, the Club Special's price.
--
-- Zapiet's product date restrictions can't be changed through its API, so
-- those two steps stay manual: they become dated to-dos on the owner's list
-- (zapiet_*_todo_id), created when the changeover is scheduled.
CREATE TABLE IF NOT EXISTS club_special_changeovers (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  -- First delivery date the Club Special carries this recipe.
  delivering_from DATE NOT NULL,
  -- The day the app switches the planner + website over.
  switch_on DATE NOT NULL,
  -- New Club Special price in pence; NULL = leave the price alone.
  club_price_pence INTEGER CHECK (club_price_pence IS NULL OR club_price_pence BETWEEN 100 AND 100000),
  -- Announcement-bar line shown on the website from switch_on; NULL = none.
  announcement TEXT,
  -- scheduled → switched (done), or cancelled.
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'switched', 'cancelled')),
  switched_at TIMESTAMP,
  -- Last Shopify problem while switching (NULL once it goes through).
  shopify_error TEXT,
  owner_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  zapiet_end_todo_id INTEGER REFERENCES todo_tasks(id) ON DELETE SET NULL,
  zapiet_start_todo_id INTEGER REFERENCES todo_tasks(id) ON DELETE SET NULL,
  created_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMP,
  cancelled_by_name TEXT,
  CHECK (switch_on <= delivering_from)
);
-- Never two live changeovers for the same delivery date.
CREATE UNIQUE INDEX IF NOT EXISTS ux_club_special_changeovers_delivering
  ON club_special_changeovers (delivering_from) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS ix_club_special_changeovers_due
  ON club_special_changeovers (switch_on) WHERE status = 'scheduled';

-- Which Shopify product is the Calzone Club Special (its price changes with
-- the recipe). Data, not logic: change it here if the product is replaced.
INSERT INTO app_settings (key, value)
VALUES ('club_special_product_handle', 'copy-of-tck-rotating-special')
ON CONFLICT (key) DO NOTHING;

-- The changeover already live: the current special (Philly Cheesesteak 2.0)
-- has delivered since 22 Sep 2026 (Graeme, 2026-10-05). Recorded so the
-- website keeps showing "Delivering from" for it.
INSERT INTO club_special_changeovers (recipe_id, delivering_from, switch_on, status, switched_at, created_by_name)
SELECT r.id, DATE '2026-09-22', DATE '2026-09-15', 'switched', NOW(), 'Migration 0148'
FROM recipes r
WHERE r.is_current_special = TRUE
  AND NOT EXISTS (SELECT 1 FROM club_special_changeovers);
