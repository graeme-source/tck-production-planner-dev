-- Advertising-efficiency targets for the Numbers page's At a Glance row
-- (Graeme, 2026-10-11). Objective I (founder command centre: profit and
-- foresight).
--
-- Three cards — new-customer ROAS over the last 7 days, new-customer ROAS
-- this month, and ROAS on total sales over the last 30 days — each coloured
-- against a target, plus a "What to do" line following the Hammersley rule
-- (beating the new-customer target → probably under-spending; below it →
-- probably over-spending). Every number that line and the colours use is
-- here, founder-editable from the cards, never in the code.
--
-- One row (id = 1). Percentages are whole-number percents: 210 = 210%.
--
--   nc_roas_7d_target_pct      new-customer ROAS target, rolling 7 days
--   nc_roas_mtd_target_pct     new-customer ROAS target, this month so far
--   total_roas_30d_target_pct  ROAS on total sales target, last 30 days
--   amber_width_pct            how far under target (as % of target) is
--                              still amber: 10 → amber from 90% to 100%,
--                              red below 90%, green at or above 100%
--   hold_band_pct              the "hold spend steady" band around the
--                              7-day target: 10 → within 90%–110% hold;
--                              at or above 110% raise; below 90% trim
--   raise_spend_min_pct /      the suggested spend increase when beating
--   raise_spend_max_pct        the target ("raise ~10–20%")
--   small_sample_spend         £ spent over the 7 days below which the
--                              advice is softened (too little to judge)
CREATE TABLE IF NOT EXISTS ad_efficiency_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nc_roas_7d_target_pct NUMERIC(7, 1) NOT NULL DEFAULT 210 CHECK (nc_roas_7d_target_pct > 0),
  nc_roas_mtd_target_pct NUMERIC(7, 1) NOT NULL DEFAULT 210 CHECK (nc_roas_mtd_target_pct > 0),
  total_roas_30d_target_pct NUMERIC(7, 1) NOT NULL DEFAULT 700 CHECK (total_roas_30d_target_pct > 0),
  amber_width_pct NUMERIC(5, 1) NOT NULL DEFAULT 10 CHECK (amber_width_pct >= 0 AND amber_width_pct <= 50),
  hold_band_pct NUMERIC(5, 1) NOT NULL DEFAULT 10 CHECK (hold_band_pct >= 0 AND hold_band_pct <= 50),
  raise_spend_min_pct NUMERIC(5, 1) NOT NULL DEFAULT 10 CHECK (raise_spend_min_pct > 0),
  raise_spend_max_pct NUMERIC(5, 1) NOT NULL DEFAULT 20 CHECK (raise_spend_max_pct >= raise_spend_min_pct),
  small_sample_spend NUMERIC(10, 2) NOT NULL DEFAULT 350 CHECK (small_sample_spend >= 0),
  updated_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO ad_efficiency_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
