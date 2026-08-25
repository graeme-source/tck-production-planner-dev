-- Production-planner capability flag on app_users: a manager subtype that
-- gates planning surfaces (weekly DPT sales suggestion first). Admins always
-- qualify without the flag.
--
-- Note: this project applies DDL via the startup migration in
-- artifacts/api-server/src/index.ts (this file mirrors the schema change,
-- same pattern as 0017/0052/0053).

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS is_production_planner boolean NOT NULL DEFAULT false;
