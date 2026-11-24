-- Artwork files kept against an item (Graeme, 24 Nov 2026: "we've got a few
-- of these things where we have to send artwork with the order. I'd like to
-- store that artwork in our system against this item … print-ready PDFs that
-- are stored at high resolution and don't do any compression"). Several per
-- item (2 for the order inserts, 10–15 for some label runs). The bytes are
-- stored exactly as uploaded; STORAGE EXTERNAL also keeps Postgres from
-- compressing them, and keeps them out of line so listing reads no file.
-- Objective C. Safe to run twice.

CREATE TABLE IF NOT EXISTS ingredient_artwork (
  id SERIAL PRIMARY KEY,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  file_blob BYTEA NOT NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE ingredient_artwork ALTER COLUMN file_blob SET STORAGE EXTERNAL;
CREATE INDEX IF NOT EXISTS ingredient_artwork_ingredient_idx ON ingredient_artwork (ingredient_id);
