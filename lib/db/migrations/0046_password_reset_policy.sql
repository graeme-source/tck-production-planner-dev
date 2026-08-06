-- Forced password reset with a 24-hour grace period (2026-08-06).
--
-- password_reset_deadline: stamped to now + 24h the FIRST time a user
-- authenticates (login, PIN login, or an existing session's /me check —
-- see ensurePasswordResetDeadline in api-server/src/routes/auth.ts) so the
-- clock starts when they first see the warning, not at deploy. While the
-- deadline is in the future the client shows a countdown warning banner;
-- once passed, a full-screen blocker forces a password change before the
-- app can be used. Cleared on any password change. The founder is exempt.
--
-- password_changed_at: stamped whenever a password is set under the new
-- policy (capital letter + number + more than 8 characters). Its presence
-- means the user is done: they are never stamped with a deadline again.
--
-- Applied at runtime by runStartupMigrations() in api-server/src/index.ts.

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS password_reset_deadline TIMESTAMP,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP;
