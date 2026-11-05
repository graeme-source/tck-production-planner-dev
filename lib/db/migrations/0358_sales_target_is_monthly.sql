-- One sales target (Graeme, 5 Nov 2026): the daily figure now comes from the
-- monthly target and edits it back, so the separate per-day row goes.
-- Objective I.
--
-- Safe to run twice.

DELETE FROM numbers_benchmarks WHERE kpi = 'sales';
