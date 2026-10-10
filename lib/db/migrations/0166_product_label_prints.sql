-- Back-label print runs (Stage 2 first cut, Graeme 2026-10-12) — the
-- traceability record of every run made from the wrapping station: who,
-- which recipe and LIVE label version (with its snapshot hash), how many,
-- the print and production days, the batch number and use-by dates printed,
-- and the plan item it was for. Objective D.
--
-- format: 'pdf' today (printed from any computer through the label
-- printer's own driver); 'tspl' / 'zpl' kept for when the print bridge
-- sends the same bitmap straight to the printer.
CREATE TABLE IF NOT EXISTS product_label_prints (
  id                SERIAL PRIMARY KEY,
  recipe_id         INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  recipe_name       TEXT NOT NULL,
  label_version_id  INTEGER REFERENCES product_label_versions(id) ON DELETE SET NULL,
  version_no        INTEGER NOT NULL,
  snapshot_hash     TEXT NOT NULL,
  count             INTEGER NOT NULL CHECK (count > 0),
  print_date        DATE NOT NULL,
  production_date   DATE NOT NULL,
  batch_code        TEXT NOT NULL,
  chilled_use_by    DATE,
  frozen_use_by     DATE,
  plan_id           INTEGER REFERENCES production_plans(id) ON DELETE SET NULL,
  plan_item_id      INTEGER REFERENCES production_plan_items(id) ON DELETE SET NULL,
  format            TEXT NOT NULL DEFAULT 'pdf' CHECK (format IN ('pdf', 'tspl', 'zpl')),
  printed_by_id     INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  printed_by_name   TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_label_prints_recipe ON product_label_prints (recipe_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_label_prints_batch ON product_label_prints (batch_code);
