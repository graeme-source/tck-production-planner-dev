-- station_changeovers was never created (found 2026-09-17 in the live logs).
--
-- The table is defined in lib/db/src/schema/production_plans.ts and written to
-- by the building station, but no migration ever created it — so it was absent
-- on live AND on every local copy, and every changeover insert has failed since
-- the feature shipped. The error is swallowed, so nothing visibly broke; what
-- was lost is the changeover timing that feeds the station pace KPIs.
--
-- Matches the Drizzle definition exactly: serial id, cascade on plan item and
-- recipe, user set null (a changeover record outlives a deleted account),
-- started_at defaulted, completed_at/duration_ms filled in on finish.

CREATE TABLE IF NOT EXISTS station_changeovers (
  id           serial PRIMARY KEY,
  plan_item_id integer NOT NULL REFERENCES production_plan_items(id) ON DELETE CASCADE,
  station_type text NOT NULL,
  user_id      integer REFERENCES app_users(id) ON DELETE SET NULL,
  recipe_id    integer NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  started_at   timestamp NOT NULL DEFAULT now(),
  completed_at timestamp,
  duration_ms  integer
);

-- The read path asks for one plan item's changeovers at a station.
CREATE INDEX IF NOT EXISTS station_changeovers_item_station_idx
  ON station_changeovers (plan_item_id, station_type);
