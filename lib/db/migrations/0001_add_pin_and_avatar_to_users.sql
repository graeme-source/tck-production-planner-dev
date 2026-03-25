-- Migration: Add PIN authentication and avatar URL fields to app_users
-- Task #36: Quick-Switch User, PIN Login & User Avatars

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS pin_hash text,
  ADD COLUMN IF NOT EXISTS pin_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until timestamp,
  ADD COLUMN IF NOT EXISTS avatar_url text;
