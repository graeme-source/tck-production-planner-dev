-- Traceability, stage 1 (Graeme, 19 Nov 2026): when someone opens a new pack
-- of a traced ingredient, they photograph its label. The AI reads the batch
-- code and use-by, and that batch counts as "in use" until the next pack of
-- that ingredient is opened on a later day. A manager can then go from a
-- pack's batch code to the supplier batches in it, or from a supplier batch
-- to the pack codes it went into. Objectives B and D.
-- Safe to run twice.

-- Which ingredients are traced. Managers change the list on the
-- Traceability page; these are the ones Graeme chose to start with.
CREATE TABLE IF NOT EXISTS traced_ingredients (
  ingredient_id INTEGER PRIMARY KEY REFERENCES ingredients(id) ON DELETE CASCADE,
  added_at TIMESTAMP NOT NULL DEFAULT NOW(),
  added_by_name TEXT
);

-- One row per pack opened (or per "new pack, same batch as last time").
CREATE TABLE IF NOT EXISTS ingredient_lot_opens (
  id SERIAL PRIMARY KEY,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  photo BYTEA,
  photo_mime TEXT,
  batch_code TEXT,
  use_by DATE,
  -- 'ai' when read from the photo, 'person' once someone typed or corrected
  -- it, 'copied' for "same batch as last time", NULL when nothing was read.
  read_by TEXT,
  same_as_id INTEGER REFERENCES ingredient_lot_opens(id) ON DELETE SET NULL,
  station TEXT,
  opened_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  opened_by_name TEXT,
  opened_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ingredient_lot_opens_ingredient_idx ON ingredient_lot_opens (ingredient_id, opened_at);
CREATE INDEX IF NOT EXISTS ingredient_lot_opens_batch_idx ON ingredient_lot_opens (lower(batch_code));

-- Graeme's starting list: the fresh meats and dairy that need a use-by at
-- goods-in, plus tomato puree, mozzarella, fior di latte, both cheddars and
-- feta. By id, and only where the ingredient exists, so this is safe on any
-- copy of the database.
INSERT INTO traced_ingredients (ingredient_id, added_by_name)
SELECT i.id, 'Starting list (19 Nov 2026)'
FROM ingredients i
WHERE i.id IN (306, 191, 154, 199, 189, 22, 70, 290, 340, 83, 37, 47, 7, 198, 61, 34)
ON CONFLICT (ingredient_id) DO NOTHING;
