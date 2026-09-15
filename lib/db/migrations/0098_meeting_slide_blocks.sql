-- Free-form presentation blocks on morning-meeting slides (Graeme,
-- 2026-09-11): a host can pin a big sentence, a photo, or a video to any
-- slide on the day, like a presentation designer. Blocks hang off the
-- per-meeting slide copies, so each day's deck starts clean.
CREATE TABLE IF NOT EXISTS meeting_slide_blocks (
  id serial PRIMARY KEY,
  slide_id integer NOT NULL REFERENCES meeting_slides(id) ON DELETE CASCADE,
  kind text NOT NULL,
  content text,
  media bytea,
  media_mime text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meeting_slide_blocks_slide ON meeting_slide_blocks(slide_id);
