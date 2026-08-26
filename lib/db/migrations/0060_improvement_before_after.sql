-- Before-and-after evidence, and issues that can become improvements
-- (Objective E — Graeme, 2026-08-28).
--
-- Two changes, both about letting an improvement start life as something
-- smaller and grow into a finished one.
--
-- 1. Attachments gain a phase. A photo taken when you spot the problem is a
--    "before"; the one taken when you've fixed it is an "after". Same table,
--    same upload path — the phase is what lets the app show them side by
--    side, and what lets someone log an idea today and finish it next week.
--    NULL means "just a photo", which is every attachment logged so far.
ALTER TABLE improvement_attachments ADD COLUMN IF NOT EXISTS phase TEXT;

-- 2. An issue can turn into an improvement — a safety problem gets fixed by
--    improving something. The link records which improvement came out of
--    which issue, so neither has to be re-typed and the pair stays joined up.
ALTER TABLE andon_issues ADD COLUMN IF NOT EXISTS improvement_id INTEGER REFERENCES improvement_submissions(id) ON DELETE SET NULL;

-- Where the problem is: 'factory' = something physical on the floor,
-- 'system' = something wrong with this app on the iPad. They go to different
-- people, so they're worth telling apart at the point of reporting.
ALTER TABLE andon_issues ADD COLUMN IF NOT EXISTS area TEXT;

CREATE INDEX IF NOT EXISTS ix_improvement_attachments_phase ON improvement_attachments (improvement_id, phase);
