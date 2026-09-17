-- Objectives get a title as well as a description (Graeme, 2026-09-17).
--
-- He had started faking it by putting the title on the first line of the
-- body — "Increase in output speed." then the detail underneath — because a
-- wall of prose is hard to scan when you are reminding someone what they are
-- working towards. The title renders bold, the description under it.
--
-- Nullable and on every note kind, not just objectives: feedback and notes
-- may want one later, and an untitled note simply renders as it always has.

ALTER TABLE employee_notes ADD COLUMN IF NOT EXISTS title text;
