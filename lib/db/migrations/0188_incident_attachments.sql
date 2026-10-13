-- Photos and short videos on accident & incident reports (Graeme,
-- 2026-10-13: "I've got a foreign object report here that I need to upload
-- an image to"). Objective B: the HACCP diary is the food-safety record,
-- and a photo of the foreign body is the strongest evidence it can hold.
--
-- Bytes live in Postgres like improvement and return-to-work attachments,
-- so the daily volume backups carry them.
--
-- Evidence rules:
--   * A row is NEVER hard-deleted. "Remove" sets deleted_at / deleted_by_* /
--     delete_reason and the bytes stay, so the diary still shows what was
--     removed, by whom and when.
--   * added_after_signing is fixed at upload time from the report's
--     signed_at. A photo added to a signed report is marked as such and
--     never touches the signed report row itself.
--   * The FK is ON DELETE RESTRICT: an incident with any attachment (even a
--     removed one) can't be deleted, so evidence can't vanish with a draft.
--
-- Idempotent: re-running changes nothing.

CREATE TABLE IF NOT EXISTS incident_attachments (
  id                   serial PRIMARY KEY,
  incident_id          integer NOT NULL REFERENCES incident_reports(id) ON DELETE RESTRICT,
  kind                 text NOT NULL,            -- 'image' | 'video'
  mime                 text NOT NULL,
  data                 bytea NOT NULL,
  file_name            text,
  size_bytes           integer,
  uploaded_by_user_id  integer REFERENCES app_users(id) ON DELETE SET NULL,
  uploaded_by_name     text,
  added_after_signing  boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  deleted_by_user_id   integer REFERENCES app_users(id) ON DELETE SET NULL,
  deleted_by_name      text,
  delete_reason        text
);
CREATE INDEX IF NOT EXISTS ix_incident_attachments_incident ON incident_attachments (incident_id, created_at);
