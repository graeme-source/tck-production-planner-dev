-- Forced testing (Graeme, 2026-10-10). Objectives E (an issue's loop is
-- only closed when the person who reported it says the fix works) and F
-- (changes are proved in real production, not assumed).
--
-- Some changes can only be tested for real — on the building station
-- tomorrow morning, after 2pm, on the first dispatch day. A test request
-- names who must try it; each of them gets a friendly, closable card (like
-- the swipe-panel walkthrough, migration 0155) when they are signed in and
-- the "when" is met, until they answer or a manager closes it.
--
-- test_requests          what to try, where (link_path = "Take me there"),
--                        when (only_on_path pattern with * = any one part,
--                        not_before, a daily London time window, plus
--                        when_text in plain words), the issue it came from
--                        (andon_issue_id), who asked (created_by NULL when
--                        made by the deploy session — source = 'deploy'),
--                        and whether a manager closed it.
-- test_request_testers   one row per person who must test it: started
--                        ("Take me there"), "Not now" snoozes, and their
--                        answer — works_easy | works_confusing |
--                        doesnt_work | cant_test — with a note and an
--                        optional photo (inline bytea, like curiosity
--                        observations). is_reporter marks the person who
--                        reported the originating issue: always asked.
-- Rules (who, when, status): api-server lib/test-request-rules.ts and
-- production-planner lib/test-requests.ts, both unit-tested.

CREATE TABLE IF NOT EXISTS test_requests (
  id               SERIAL PRIMARY KEY,
  title            TEXT NOT NULL,
  steps            TEXT NOT NULL,
  link_path        TEXT,
  only_on_path     TEXT,
  not_before       TIMESTAMPTZ,
  daily_from       TEXT,
  daily_until      TEXT,
  when_text        TEXT,
  andon_issue_id   INTEGER REFERENCES andon_issues(id) ON DELETE SET NULL,
  source           TEXT NOT NULL DEFAULT 'person',
  fix_ref          TEXT,
  created_by       INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name  TEXT NOT NULL,
  closed_at        TIMESTAMPTZ,
  closed_by_name   TEXT,
  close_note       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS test_requests_issue_idx ON test_requests (andon_issue_id);

CREATE TABLE IF NOT EXISTS test_request_testers (
  id               SERIAL PRIMARY KEY,
  request_id       INTEGER NOT NULL REFERENCES test_requests(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  is_reporter      BOOLEAN NOT NULL DEFAULT FALSE,
  started_at       TIMESTAMPTZ,
  snoozed_until    TIMESTAMPTZ,
  snooze_count     INTEGER NOT NULL DEFAULT 0,
  answer           TEXT,
  note             TEXT,
  photo_mime       TEXT,
  photo            BYTEA,
  answered_at      TIMESTAMPTZ,
  UNIQUE (request_id, user_id)
);

CREATE INDEX IF NOT EXISTS test_request_testers_user_idx ON test_request_testers (user_id) WHERE answer IS NULL;
