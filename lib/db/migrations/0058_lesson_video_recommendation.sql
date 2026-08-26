-- Which days of a week actually want a video (Objective E — Graeme,
-- 2026-08-26: "We don't want it every day, maybe two or three a week").
--
-- The lesson writer already decides which days would land better with a
-- clip. Until now that decision was returned once, shown in a toast, and
-- then lost — so a week where the recommended clip was never pasted in
-- looked identical to a week that deliberately had none.
--
-- Storing it makes the gap visible during the Friday review of next week:
-- "Tuesday was meant to have a video and hasn't got one."

ALTER TABLE lean_examples ADD COLUMN IF NOT EXISTS video_wanted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lean_examples ADD COLUMN IF NOT EXISTS video_rationale TEXT;

-- The 45 lessons written before this all carry a video from an earlier pass
-- that gave every day one. Treat the ones that have a clip as intended for
-- now; the weekly review is where they get thinned back to two or three.
UPDATE lean_examples
   SET video_wanted = TRUE
 WHERE video_url IS NOT NULL AND video_url <> '';
