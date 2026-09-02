-- Improvement celebrations (Graeme, 2026-09-02: "a really positive moment"
-- — the WhatsApp-group buzz, in the app). A finished improvement now
-- notifies the whole team, so the notification needs to point at the
-- improvement the same way andon notifications point at their issue.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS improvement_id INTEGER
  REFERENCES improvement_submissions(id) ON DELETE CASCADE;
