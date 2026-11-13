-- Dessert labels printed per dispatch day (Graeme, 13 Nov 2026): the
-- desserts report asks only for the labels still needed — orders for the day
-- minus what's already been printed — so a second or third despatch prints
-- just the new orders' labels, and says "All labels printed" when there are
-- none. kind = 'five_pack' (item_key = the flavour's variant id, else its
-- name) or 'despatch' (item_key = the recipe id). Objective C. Safe to run
-- twice.

CREATE TABLE IF NOT EXISTS dessert_label_prints (
  id SERIAL PRIMARY KEY,
  tag DATE NOT NULL,
  kind TEXT NOT NULL,
  item_key TEXT NOT NULL,
  copies INTEGER NOT NULL CHECK (copies > 0),
  printed_by INTEGER,
  printed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_dessert_label_prints_tag ON dessert_label_prints (tag, kind);
