-- Planned emails on the marketing calendar (Graeme, 2026-09-30). Inspired by
-- the peak-trading calendar spreadsheet (Date | Phase | Offer | Core message |
-- Subject line | SMS | Cadence | Depth | Website change | Meta change):
-- campaigns are periods of emails, so each planned email sits on a send day
-- and belongs — automatically, by date — to the campaign (marketing_events
-- row) whose dates contain that day. Membership is NEVER stored: move the
-- email's date into the next campaign's window and it is in that campaign.
-- Objectives I (founder foresight — the whole email plan in one place) and
-- F (every change attributed, nothing hard-deleted).
--
-- marketing_emails — one planned email:
--   send_date / send_time      the day (and optional HH:MM, London) it goes
--   subject, offer, core_message, sms_suggestion, cadence (free text such as
--   "Fri + weekend sends"), audiences (all | new | returning | vip | lapsed),
--   audience_other (a specific list), website_change, meta_change, notes,
--   status (idea | planned | scheduled | sent),
--   klaviyo_campaign_id / _name  optional link to the real Klaviyo send so
--                                plan and reality show as one item. The name is
--                                a snapshot for display when Klaviyo is slow.
--   created/updated by (id + frozen name), soft delete (deleted_at/by).
--
-- marketing_email_history — one row per change (created / edited / moved /
-- linked / unlinked / deleted) with a plain-English sentence and the changed
-- fields as JSON, exactly like marketing_event_history.
--
-- New tables only; no existing row is touched.

CREATE TABLE IF NOT EXISTS marketing_emails (
  id SERIAL PRIMARY KEY,
  send_date DATE NOT NULL,
  send_time TEXT CHECK (send_time IS NULL OR send_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  subject TEXT NOT NULL CHECK (btrim(subject) <> ''),
  offer TEXT,
  core_message TEXT,
  sms_suggestion TEXT,
  cadence TEXT,
  audiences TEXT[] NOT NULL DEFAULT '{}'::text[],
  audience_other TEXT,
  website_change TEXT,
  meta_change TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('idea', 'planned', 'scheduled', 'sent')),
  klaviyo_campaign_id TEXT,
  klaviyo_campaign_name TEXT,
  created_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  updated_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  deleted_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  deleted_by_name TEXT
);
CREATE INDEX IF NOT EXISTS ix_marketing_emails_date ON marketing_emails (send_date) WHERE deleted_at IS NULL;
-- One Klaviyo send is the reality of at most one live planned email.
CREATE UNIQUE INDEX IF NOT EXISTS ux_marketing_emails_klaviyo ON marketing_emails (klaviyo_campaign_id)
  WHERE deleted_at IS NULL AND klaviyo_campaign_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS marketing_email_history (
  id SERIAL PRIMARY KEY,
  email_id INTEGER NOT NULL REFERENCES marketing_emails(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  user_name TEXT,
  action TEXT NOT NULL CHECK (action IN ('created', 'edited', 'moved', 'linked', 'unlinked', 'deleted')),
  summary TEXT NOT NULL,
  changes JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_marketing_email_history_email ON marketing_email_history (email_id, created_at);
