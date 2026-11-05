-- Numbers benchmarks come down to two figures (Graeme, 5 Nov 2026): a minimum
-- and a stretch per KPI. Objective I.
--
-- Safe to run twice.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'numbers_benchmarks' AND column_name = 'very_good') THEN
    ALTER TABLE numbers_benchmarks RENAME COLUMN very_good TO stretch;
  END IF;
END $$;

ALTER TABLE numbers_benchmarks DROP COLUMN IF EXISTS good;

-- Starting figures from October 2026's averages (the minimum, near that
-- average) with a stretch above it for growth. New customer revenue is
-- Graeme's own £1,500 and £2,000. Ad spend and conversion rate start unset.
-- Money and counts are per day. Anything already set is left alone.
INSERT INTO numbers_benchmarks (kpi, minimum, stretch) VALUES
  ('sales', 4200, 5000),
  ('aov', 59, 62),
  ('newCustomerShare', 35, 40),
  ('newCustomers', 25, 32),
  ('newCustomerRevenue', 1500, 2000),
  ('newCustomerRoas', 210, 250),
  ('recurringSubs', 14, 17),
  ('newSubs', 4.5, 6),
  ('subscriptionRevenue', 1100, 1300)
ON CONFLICT (kpi) DO NOTHING;
