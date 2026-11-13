-- Production KPIs in one place (Graeme, 13 Nov 2026: "Where is this set? Is
-- there a place I can look at all my production KPIs?"). Each station's
-- standard (on target) and stretch, read by the dashboard tiles, the
-- wrapping station and the packing screen. Objective G.
--
-- Starting figures are what the screens used until now: packing 55 / 60
-- orders an hour (the packing screen's "On target" / "Smashing it" — the
-- dashboard tile said 50, which is why the two disagreed). Wrapping 115 /
-- 135 packs an hour: wrapping is now timed first wrap → last wrap minus the
-- breaks (services/wrapping-pace.ts), on which 15 Oct–12 Nov read a median
-- of 115 and a top quarter of 132+ — the old 180 / 240 belonged to the
-- method that cut out every gap over 20 minutes. Anything already set is
-- left alone. Safe to run twice.

CREATE TABLE IF NOT EXISTS production_kpis (
  kpi TEXT PRIMARY KEY,
  standard NUMERIC(10, 2) NOT NULL CHECK (standard > 0),
  stretch NUMERIC(10, 2) CHECK (stretch IS NULL OR stretch > 0),
  updated_by_id INTEGER,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO production_kpis (kpi, standard, stretch) VALUES
  ('packing', 55, 60),
  ('wrapping', 115, 135)
ON CONFLICT (kpi) DO NOTHING;
