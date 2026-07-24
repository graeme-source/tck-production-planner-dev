-- Migration: sop_steps — retrofit the missing FK to standards_sops
--
-- The bootstrap DDL declares `sop_id INTEGER NOT NULL REFERENCES
-- standards_sops(id) ON DELETE CASCADE`, but the table pre-dates that
-- DDL and CREATE TABLE IF NOT EXISTS never retrofits constraints — so
-- the live/local table had NO foreign key at all. Deleting an SOP left
-- its steps (including image_data/video_data BYTEA blobs) stranded as
-- invisible orphans, silently bloating the database.
--
-- Applied idempotently at API startup (see runStartupMigrations in
-- artifacts/api-server/src/index.ts): purge existing orphans, then add
-- the constraint if no FK exists yet.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sop_steps'::regclass AND contype = 'f'
  ) THEN
    DELETE FROM sop_steps s WHERE NOT EXISTS (
      SELECT 1 FROM standards_sops ss WHERE ss.id = s.sop_id
    );
    ALTER TABLE sop_steps
      ADD CONSTRAINT sop_steps_sop_id_fkey
      FOREIGN KEY (sop_id) REFERENCES standards_sops(id) ON DELETE CASCADE;
  END IF;
END $$;
