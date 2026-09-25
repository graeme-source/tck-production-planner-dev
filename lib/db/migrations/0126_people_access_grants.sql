-- People section access, per person, switched on in Settings → Team & Access
-- (Graeme, 2026-09-25: "I can enable people, but they have to set a private
-- pin in order to get into People").
--
-- Until now who could open the People section (employee records, reviews,
-- return-to-work forms) was a hard-coded email list in code
-- (PEOPLE_DATA_EMAILS). It now lives here, one row per person who has it.
-- A role never grants it — promoting someone to admin or manager must not
-- hand them the personnel files. Only the founder account can add or remove
-- a row (enforced by the API, routes/people-access.ts).
--
-- Having a row is not enough on its own: the API also refuses every People
-- request until that person has set their private People PIN (migration
-- 0123) and unlocked People with it.

CREATE TABLE IF NOT EXISTS people_access_grants (
  user_id INTEGER PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  granted_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  granted_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Every grant and revoke, kept even after the grant row is gone, so "who
-- could see the personnel files, and who decided that" always has an answer.
CREATE TABLE IF NOT EXISTS people_access_audit (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  user_email TEXT,
  action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
  by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_people_access_audit_user ON people_access_audit (user_id);

-- Seed: exactly the people the old hard-coded list named, matched by email.
-- The local test account only exists on local copies; on live it matches
-- nothing and is simply skipped.
INSERT INTO people_access_grants (user_id, granted_by_user_id)
SELECT u.id,
       (SELECT f.id FROM app_users f WHERE lower(f.email) = 'graeme@thecalzonekitchen.co.uk' LIMIT 1)
  FROM app_users u
 WHERE lower(u.email) IN (
         'graeme@thecalzonekitchen.co.uk',
         'lornabrown17@icloud.com',
         'claude-test@thecalzonekitchen.co.uk'
       )
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO people_access_audit (user_id, user_email, action, by_user_id, note)
SELECT g.user_id, u.email, 'grant', g.granted_by_user_id,
       'Carried over from the old hard-coded People list (migration 0126)'
  FROM people_access_grants g
  JOIN app_users u ON u.id = g.user_id
 WHERE NOT EXISTS (SELECT 1 FROM people_access_audit a WHERE a.user_id = g.user_id);
