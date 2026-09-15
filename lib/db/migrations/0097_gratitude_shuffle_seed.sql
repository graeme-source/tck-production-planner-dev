-- Shuffle counter for the gratitude slide's fallback themed image.
-- The day's image is deterministic from the date; bumping this seed from
-- the meeting setup screen picks a different one when the day's pick is a
-- dud (Graeme, 2026-09-11: "today there's a photo of a cat").
ALTER TABLE morning_meetings ADD COLUMN IF NOT EXISTS gratitude_seed integer;
