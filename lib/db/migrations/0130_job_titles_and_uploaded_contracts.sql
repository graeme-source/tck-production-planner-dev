-- Job titles on people, and old paper/PDF contracts on their record
-- (Graeme, 2026-09-25: "Ability to change the role of a person ... to what's
-- in their contract. I also want the ability to upload a contract manually
-- into someone's employee record, an old PDF that we created at the start of
-- their employment ... then we'll create new contracts from the data in
-- that."). Objectives I (founder command centre) and F (records we trust).
--
-- 1) app_users.job_title — the person's job title ("Production Operative",
--    "Head Chef"). NOT the app permission role (admin/manager/viewer), which
--    this never touches. Until now the People pages showed the title from the
--    latest issued contract and otherwise fell back to the app role, so most
--    people read as "Team member". Editable from People; issuing a contract
--    with a different title updates it.

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS job_title_updated_at TIMESTAMP;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS job_title_updated_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL;

-- Seed from each person's latest issued contract, where they have one. Only
-- fills blanks, so re-running never overwrites a title someone has set.
UPDATE app_users u
   SET job_title = c.job_title
  FROM (
    SELECT DISTINCT ON (user_id) user_id, job_title
      FROM employment_contracts
     WHERE user_id IS NOT NULL AND btrim(job_title) <> ''
     ORDER BY user_id, issued_at DESC
  ) c
 WHERE c.user_id = u.id
   AND u.job_title IS NULL;

-- 2) uploaded_contracts — a previous contract as the document it is (a PDF,
--    or a photo of the paper copy), filed on the person's record. Deliberately
--    a SEPARATE table from employment_contracts: those rows are contracts
--    issued and signed in the app, protected by the signed-contract triggers
--    (migration 0085). An uploaded file was never issued or signed here and
--    must never look as if it had been.
--
--    It carries pay, so the API shows it to the HR-records accounts
--    (middleware/hr-access.ts — the founder today) and to the employee
--    themself, read-only; nobody else, whatever their role or People access.
--
--    ON DELETE RESTRICT: a person with a filed contract can't be hard-deleted
--    out from under it (same spirit as signed contracts); deactivate instead.

CREATE TABLE IF NOT EXISTS uploaded_contracts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  file_name TEXT,
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  byte_size INTEGER NOT NULL,
  original_issue_date DATE,
  notes TEXT,
  uploaded_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  uploaded_by_name TEXT,
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  -- What Claude read off the document (job title, rate of pay, weekly hours,
  -- start date, name — each with the text it came from), kept so the
  -- founder's confirm card reopens without paying for a second read.
  extraction JSONB,
  extracted_at TIMESTAMP,
  -- The founder's corrected values from the confirm card (autosaved), which
  -- pre-fill the contract issuer. Nothing is ever issued from this directly.
  prefill JSONB,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS uploaded_contracts_user_idx ON uploaded_contracts (user_id);
