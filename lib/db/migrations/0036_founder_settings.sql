-- Founder settings — key/value store for Founder Focus integrations
-- (Stage 2: iCloud CalDAV credentials; later: one.com IMAP).
--
-- Deliberately NOT app_settings: that table is readable by ordinary
-- logged-in users via the settings routes, and these values include the
-- founder's app-specific passwords. Only the founder-gated founder-focus
-- routes touch this table, and the API never echoes secret values back —
-- status endpoints report only that a value is set.
--
-- Applied idempotently at API startup (runStartupMigrations).

CREATE TABLE IF NOT EXISTS founder_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
