-- Ad spend learns where its numbers came from (Graeme, 2026-09-18).
--
-- founder_ad_spend has been hand-typed since it shipped: one figure a day,
-- entered on the Numbers panel. The Meta Marketing API can now fill it in
-- automatically, which creates a question the table couldn't answer — is
-- this number one Graeme typed, or one a sync wrote?
--
-- It matters because the rule is absolute: A HAND-ENTERED NUMBER ALWAYS
-- WINS. A sync may create a row, and may update a row it wrote itself, but
-- it must never overwrite a figure a person typed. Without a source column
-- there is no way to tell the two apart, so the sync would either clobber
-- real entries or refuse to update anything.
--
--   source     'manual' = typed on the Numbers panel (the default, and what
--                         every existing row is)
--              'meta'   = written by the Meta Marketing API sync
--   synced_at  when the sync last wrote this row; NULL on hand-entered rows
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, and the CREATE TABLE guard means it
-- is safe whichever order the two migration systems run in on a fresh
-- database (runStartupMigrations creates this table today, and runs first,
-- but that is not a thing to depend on).

CREATE TABLE IF NOT EXISTS founder_ad_spend (
  spend_date DATE PRIMARY KEY,
  amount     NUMERIC(10,2) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE founder_ad_spend
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE founder_ad_spend
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP;

-- The sync asks "what is the latest day I have already written?" on every
-- run, to work out how far back to fetch.
CREATE INDEX IF NOT EXISTS founder_ad_spend_source_date_idx
  ON founder_ad_spend (source, spend_date DESC);
