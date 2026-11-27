-- Back labels through the print bridge (Graeme, 27 Nov 2026). Objective C.
-- Safe to run twice.
--
-- The wrapping PC prints a back-label run ONE label per Windows print job,
-- so a roll running out only retries the label in the printer — not the
-- whole run (27 Nov: 50–60 extra labels). A run is a print_jobs row with
-- kind 'back-labels'; status runs queued → printing ⇄ paused → done |
-- failed | cancelled | expired (lib/product-labels bridge-job.ts).
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS plan_item_id INTEGER REFERENCES production_plan_items(id) ON DELETE SET NULL;
-- The labels in print order: [{ page, copies }] (a pair label is two runs;
-- "print N more" appends runs). Total = the sum of copies.
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS label_runs JSONB;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS total_count INTEGER;
-- Labels the bridge has confirmed printed. Only ever goes up; a label
-- counted here is never sent again.
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS printed_count INTEGER NOT NULL DEFAULT 0;
-- Which bridge holds the run, and until when — a restarted bridge takes
-- its own run straight back; another bridge waits for the lease to lapse.
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS claimed_by TEXT;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS lease_until TIMESTAMP;
-- 'out-of-labels' | 'offline' | 'attention' | 'stuck' while paused.
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS pause_reason TEXT;
-- The London day the labels are dated; a run never prints on a later day.
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS print_date DATE;
-- The product_label_prints row for this run (count = packs labelled so far).
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS label_print_id INTEGER REFERENCES product_label_prints(id) ON DELETE SET NULL;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS ix_print_jobs_back_labels
  ON print_jobs (recipe_id, plan_item_id, id DESC) WHERE kind = 'back-labels';

-- The single-label PDF for each label of a run (one row per page: 1, or 2
-- for a pair label), rendered once when the run is made so every label in
-- it is the same bytes. Only today's runs need them: older pages are
-- cleared when a new run is made (the run itself, and its record in
-- product_label_prints, are kept).
CREATE TABLE IF NOT EXISTS print_job_pages (
  job_id  INTEGER NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL,
  pdf     BYTEA NOT NULL,
  PRIMARY KEY (job_id, page_no)
);
