-- Production KPIs in one place (Graeme, 13 Nov 2026: "Where is this set? Is
-- there a place I can look at all my production KPIs?"). Each station's
-- standard (on target) and stretch, read by the dashboard tiles, the
-- wrapping station and the packing screen. Objective G.
--
-- Starting figures are what the screens used until now: packing 55 / 60
-- orders an hour (the packing screen's "On target" / "Smashing it" — the
-- dashboard tile said 50, which is why the two disagreed), wrapping 180 /
-- 240 packs an hour. Anything already set is left alone. Safe to run twice.

CREATE TABLE IF NOT EXISTS production_kpis (
  kpi TEXT PRIMARY KEY,
  standard NUMERIC(10, 2) NOT NULL CHECK (standard > 0),
  stretch NUMERIC(10, 2) CHECK (stretch IS NULL OR stretch > 0),
  updated_by_id INTEGER,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO production_kpis (kpi, standard, stretch) VALUES
  ('packing', 55, 60),
  ('wrapping', 180, 240)
ON CONFLICT (kpi) DO NOTHING;
