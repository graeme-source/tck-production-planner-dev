-- "You haven't looked at these yet" — a badge on the Improvements nav item
-- showing how many improvements a person has never opened (Graeme,
-- 2026-09-03). Opening one checks it off.
--
-- One row per person per improvement they have opened. Absence means unseen,
-- so a new improvement is unseen by everyone the moment it is logged, without
-- having to write a row for every person up front.

CREATE TABLE IF NOT EXISTS improvement_views (
  id serial PRIMARY KEY,
  improvement_id integer NOT NULL REFERENCES improvement_submissions(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  viewed_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_improvement_view UNIQUE (improvement_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_improvement_views_user
  ON improvement_views (user_id, improvement_id);

-- Everything that already exists counts as seen.
--
-- Without this, every person would open the app on day one to a badge of
-- thirty-odd — the entire history of the feature — and a badge that starts
-- at "impossible" is one nobody ever clears. It has to start at zero and
-- only ever count what is genuinely new.
--
-- The empty-table guard matters more than it looks. This backfill is
-- destructive if it ever runs a second time: it would mark every improvement
-- logged since as already seen by everyone, silently killing the badge for
-- good. The runner records applied files so it normally cannot happen — but
-- a hand-applied file, a restored database, or a re-baseline all can, and it
-- took about five minutes to trigger by accident while building this. So the
-- backfill only ever runs against a table that has never held a row.
INSERT INTO improvement_views (improvement_id, user_id, viewed_at)
SELECT i.id, u.id, NOW()
FROM improvement_submissions i
CROSS JOIN app_users u
WHERE u.is_active
  AND NOT EXISTS (SELECT 1 FROM improvement_views)
ON CONFLICT (improvement_id, user_id) DO NOTHING;
