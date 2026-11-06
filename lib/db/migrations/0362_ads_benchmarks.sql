-- Targets for the Ads page (Graeme, 6 Nov 2026): cost per result, purchase
-- ROAS and cost per reach, in the same table as the Numbers panels. Objective I.
--
-- Starting figures come from the last 30 days on Meta (6 Nov 2026: £19.98 cost
-- per result, 2.80 ROAS) with a stretch beyond. Cost per reach is held in pence
-- per person reached. Anything already set is left alone. Safe to run twice.

INSERT INTO numbers_benchmarks (kpi, minimum, stretch) VALUES
  ('adsCostPerResult', 20, 16),
  ('adsPurchaseRoas', 2.8, 3.5),
  ('adsCostPerReach', 2.5, 2)
ON CONFLICT (kpi) DO NOTHING;
