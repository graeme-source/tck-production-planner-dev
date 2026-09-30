-- Email stages + approvals on the marketing calendar (Graeme, 2026-09-30).
-- Objectives I (founder foresight — nothing goes to customers he hasn't
-- seen) and F (every approval attributed and kept).
--
-- 1. STAGE replaces the old status set on marketing_emails.status:
--      planned    an entry saying we'll build this email
--      created    a draft exists in Klaviyo ("Created in Klaviyo")
--      scheduled  scheduled in Klaviyo
--      sent       gone out
--    Existing rows: idea → planned (planned / scheduled / sent unchanged).
--    When a plan is linked to a Klaviyo campaign the stage shown is DERIVED
--    from Klaviyo on every read; the stored value is the manual stage used
--    only while unlinked. The column keeps its name (status).
--
-- 2. marketing_email_approvals — ONE row per approvable thing, keyed by
--    target_key:
--      'plan:<marketing_emails.id>'   a planned email NOT linked to Klaviyo
--      'klaviyo:<campaign id>'        a Klaviyo campaign — on its own, or the
--                                     one a planned email is linked to (the
--                                     plan and its campaign share this row)
--    approved (boolean) is the current answer; approved_by/at and the
--    snapshot (subject, Klaviyo campaign id + name) are as they were at
--    approval. If the subject line now differs from the snapshot the screen
--    says "Changed since approval" and it needs approving again. Undo keeps
--    the row (approved = false, unapproved_by/at set).
--
-- 3. marketing_email_approval_history — every approve / undo, who and when,
--    with the subject line at that moment. Plans also get a line in
--    marketing_email_history (actions 'approved' / 'unapproved' added).
--
-- Who may approve is a founder-only feature grant, "marketing.approve_emails"
-- (Graeme, or someone he grants it to) — enforced by the API, not here.

ALTER TABLE marketing_emails DROP CONSTRAINT IF EXISTS marketing_emails_status_check;
UPDATE marketing_emails SET status = 'planned' WHERE status NOT IN ('planned', 'created', 'scheduled', 'sent');
ALTER TABLE marketing_emails ALTER COLUMN status SET DEFAULT 'planned';
ALTER TABLE marketing_emails ADD CONSTRAINT marketing_emails_status_check
  CHECK (status IN ('planned', 'created', 'scheduled', 'sent'));

ALTER TABLE marketing_email_history DROP CONSTRAINT IF EXISTS marketing_email_history_action_check;
ALTER TABLE marketing_email_history ADD CONSTRAINT marketing_email_history_action_check
  CHECK (action IN ('created', 'edited', 'moved', 'linked', 'unlinked', 'deleted', 'approved', 'unapproved'));

CREATE TABLE IF NOT EXISTS marketing_email_approvals (
  id SERIAL PRIMARY KEY,
  target_key TEXT NOT NULL UNIQUE CHECK (target_key ~ '^(plan:[0-9]+|klaviyo:.+)$'),
  email_id INTEGER REFERENCES marketing_emails(id) ON DELETE SET NULL,
  klaviyo_campaign_id TEXT,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  subject TEXT,
  klaviyo_campaign_name TEXT,
  send_date DATE,
  approved_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  approved_by_name TEXT,
  approved_at TIMESTAMP,
  unapproved_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  unapproved_by_name TEXT,
  unapproved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_email_approval_history (
  id SERIAL PRIMARY KEY,
  approval_id INTEGER NOT NULL REFERENCES marketing_email_approvals(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('approved', 'unapproved', 'moved')),
  summary TEXT NOT NULL,
  subject TEXT,
  user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  user_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_marketing_email_approval_history_approval
  ON marketing_email_approval_history (approval_id, created_at);
