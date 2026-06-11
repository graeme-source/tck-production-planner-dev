-- Migration: Add an optional photo + caption to the morning-meeting
-- gratitude slide.
--
-- The closing gratitude slide can now show a photo the host uploads for the
-- day, with a short caption. Stored inline on the per-day morning_meetings
-- row as bytea (same approach as risk_assessments / improvement attachments)
-- so no object storage is needed. Because it lives on the per-day row, the
-- photo is naturally "fresh each day" — a new meeting starts with none.
--
-- When no photo is uploaded, the front-end falls back to a live themed image
-- (sunset / flowers / food / nature …) from a free external service, so this
-- column simply being NULL is the normal/default state.
--
-- Startup migrations in artifacts/api-server/src/index.ts apply this
-- (idempotent ADD COLUMN IF NOT EXISTS). This file mirrors the schema in
-- lib/db/src/schema/morning_meetings.ts for reference.

ALTER TABLE morning_meetings
  ADD COLUMN IF NOT EXISTS gratitude_photo       BYTEA,
  ADD COLUMN IF NOT EXISTS gratitude_photo_mime  TEXT,
  ADD COLUMN IF NOT EXISTS gratitude_caption     TEXT;
