-- Benchmarks for the Numbers page panels (Graeme, 5 Nov 2026): a minimum, good
-- and very good figure per KPI, which grade each panel on the Advertising
-- Efficiency colour scale. Money and counts that build up over time are held
-- per day, so they work for any period. Objective I.
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS numbers_benchmarks (
  kpi TEXT PRIMARY KEY,
  minimum NUMERIC(14, 2) CHECK (minimum >= 0),
  good NUMERIC(14, 2) CHECK (good >= 0),
  very_good NUMERIC(14, 2) CHECK (very_good >= 0),
  updated_by_id INTEGER,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
