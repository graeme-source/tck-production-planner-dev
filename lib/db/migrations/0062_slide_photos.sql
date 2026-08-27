-- A photo on any morning-meeting slide, not just gratitude
-- (Graeme, 2026-08-26: "I need to be able to add photos to reminder pages
-- and stuff so I can remind people about something, but also show them it
-- at the same time with a screenshot or a picture").
--
-- The gratitude photo lives on the meeting row, which allowed exactly one
-- per day and only on that one slide. Moving the capability onto the slide
-- means any slide can carry one — a reminder with the thing it's reminding
-- people about, a screenshot of the screen being described.
--
-- Slides are per-meeting copies cloned from the template, so a photo here
-- belongs to that day and disappears with it, which is what a reminder
-- photo should do. The template's own slides are never given photos.
--
-- Stored inline as bytea, same as the gratitude photo and improvement
-- media: the volume is a handful of images a day, and object storage isn't
-- wired up for this app yet.
ALTER TABLE meeting_slides ADD COLUMN IF NOT EXISTS photo BYTEA;
ALTER TABLE meeting_slides ADD COLUMN IF NOT EXISTS photo_mime TEXT;
ALTER TABLE meeting_slides ADD COLUMN IF NOT EXISTS photo_caption TEXT;
