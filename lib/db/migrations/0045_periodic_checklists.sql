-- Periodic checklist schedule (2026-08-05, Graeme): station checklists gain
-- an every-4-weeks option alongside daily/weekly/specific-days — TCK runs
-- 13 four-week periods a year and some cleaning/maintenance tasks belong to
-- that cycle, not the week.
--
-- schedule = 'periodic': due on its schedule_days (like weekly) in every
-- week that is a whole multiple of 4 weeks from the anchor's week.
-- schedule_anchor_date picks WHICH week of the cycle the task lands, so
-- periodic tasks can be staggered across the period; null anchors fall back
-- to the template's created_at week. Matching lives in
-- templateMatchesDay (api-server routes/checklists.ts) and is shared by the
-- station checklist and the HACCP outstanding-checks report.
--
-- Applied idempotently at API startup (runStartupMigrations).

ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS schedule_anchor_date DATE;
