-- Return-to-work forms (Graeme, 2026-09-14): after a spell of sick leave a
-- colleague completes this with a manager. COMPLETELY PRIVATE: readable by
-- the colleague themselves and the named RTW managers only (founder +
-- Lorna Brown — middleware/rtw-access.ts is the single gate, same pattern
-- as HR records).
CREATE TABLE IF NOT EXISTS return_to_work_forms (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  absence_start date NOT NULL,
  absence_end date,
  return_date date,
  reason_category text,                 -- Illness / Injury / Medical / Other
  reason_details text,
  support_notes text,                   -- adjustments or support discussed
  manager_name text,                    -- who sat in on the conversation
  colleague_signed_at timestamptz,
  manager_user_id integer REFERENCES app_users(id),
  manager_signed_at timestamptz,
  status text NOT NULL DEFAULT 'draft', -- draft | complete
  created_by_user_id integer REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rtw_user ON return_to_work_forms(user_id, absence_start);
