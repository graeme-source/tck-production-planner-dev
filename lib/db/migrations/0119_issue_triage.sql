-- The issue pipeline's in-app half (docs/ISSUE_PIPELINE.md §3–§6, 2026-09-24).
--
-- The team reports app problems into the Andon log. A scheduled Claude Code
-- session reads NEW app-area issues through a token-authed API, investigates
-- each one against the code and the data, and writes back a recommendation.
-- Graeme approves or rejects each on the Fix queue page; approved items get
-- fixed on review branches; after he deploys, the reporter is told their
-- report changed the app. Nothing here writes code or ships anything — it is
-- the ledger the humans and the session share.
--
-- Three tables:
--
-- issue_triage — ONE row per andon issue: the CURRENT recommendation and
--   where it is in the pipeline. The Fix queue, the "approved" work queue
--   and the "is this issue triaged yet?" check all read one row per issue,
--   so the unique index on andon_issue_id keeps those queries trivial.
--
-- issue_triage_events — append-only history. Every triage write, every
--   decision (approve / reject / reply) and every status move snapshots the
--   row as it was. Why a history table AND a current row: Graeme's decisions
--   must never be silently lost (a forced re-triage resets the current row
--   to 'proposed', and the decision it replaced lives on here), but the live
--   screens should never have to work out "latest wins" from a log.
--
-- issue_fix_notices — the full-screen "Your report has been fixed — please
--   test it" pop-up for the person who reported the issue. Queued by
--   resolve-issue (after deploy), cleared only when the reporter taps
--   "Test it now" or "I'll test it later"; which button and when is kept so
--   the Fix queue card can show the loop closed.
--
-- Idempotent (IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS issue_triage (
  id                   serial PRIMARY KEY,
  andon_issue_id       integer NOT NULL REFERENCES andon_issues(id) ON DELETE CASCADE,
  -- defect | data_fix | understanding | improvement | needs_info | not_app
  lane                 text NOT NULL,
  verdict_summary      text NOT NULL,
  explanation          text NOT NULL DEFAULT '',
  proposed_fix         text NOT NULL DEFAULT '',
  objective            text,
  blast_radius         text NOT NULL DEFAULT 'low',     -- low | medium | high
  confidence           text NOT NULL DEFAULT 'medium',  -- high | medium | low
  -- Order engine, plan calculator, stock mutations, Shopify writes, schema
  -- changes: fuller summary, never batched with other changes.
  no_go_zone           boolean NOT NULL DEFAULT false,
  -- Changing agreed behaviour (vs restoring it) = a decision BEFORE code.
  behaviour_change     boolean NOT NULL DEFAULT false,
  question_for_graeme  text,
  related_issue_ids    integer[] NOT NULL DEFAULT '{}',
  cause_tag            text,
  -- proposed | approved | rejected | in_progress | fixed | wont_fix
  status               text NOT NULL DEFAULT 'proposed',
  -- Graeme's "Reply / ask": his note sits in decision_note and this flag
  -- puts the issue back in front of the scheduled session to re-triage.
  awaiting_retriage    boolean NOT NULL DEFAULT false,
  decided_by           text,
  decided_by_user_id   integer REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at           timestamp,
  decision_note        text,
  fix_ref              text,
  fixed_at             timestamp,
  -- When resolve-issue closed the andon issue and told the reporter.
  issue_resolved_at    timestamp,
  triaged_at           timestamp NOT NULL DEFAULT now(),
  triaged_by           text NOT NULL DEFAULT 'claude-code',
  created_at           timestamp NOT NULL DEFAULT now(),
  updated_at           timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS issue_triage_issue_uq ON issue_triage (andon_issue_id);
CREATE INDEX IF NOT EXISTS issue_triage_status_idx ON issue_triage (status, triaged_at DESC);

CREATE TABLE IF NOT EXISTS issue_triage_events (
  id              serial PRIMARY KEY,
  triage_id       integer NOT NULL REFERENCES issue_triage(id) ON DELETE CASCADE,
  andon_issue_id  integer NOT NULL REFERENCES andon_issues(id) ON DELETE CASCADE,
  -- triaged | retriaged | approved | rejected | replied | status | issue_resolved | notice_ack
  event           text NOT NULL,
  actor           text,
  note            text,
  -- The issue_triage row as it was AFTER this event.
  snapshot        jsonb,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_triage_events_triage_idx ON issue_triage_events (triage_id, created_at);

CREATE TABLE IF NOT EXISTS issue_fix_notices (
  id               serial PRIMARY KEY,
  andon_issue_id   integer NOT NULL REFERENCES andon_issues(id) ON DELETE CASCADE,
  triage_id        integer REFERENCES issue_triage(id) ON DELETE CASCADE,
  user_id          integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  -- The reporter's own words, shortened, so they recognise which report.
  quote            text NOT NULL,
  what_changed     text NOT NULL,
  -- In-app relative path to test on ("/station/wrapping"), never a URL.
  test_path        text,
  created_at       timestamp NOT NULL DEFAULT now(),
  acknowledged_at  timestamp,
  ack_action       text  -- test_now | later
);

-- The interstitial asks "anything unacknowledged for me?" on every page.
CREATE INDEX IF NOT EXISTS issue_fix_notices_pending_idx
  ON issue_fix_notices (user_id) WHERE acknowledged_at IS NULL;
-- One pending notice per issue — a retried resolve must not stack pop-ups.
CREATE UNIQUE INDEX IF NOT EXISTS issue_fix_notices_one_pending_uq
  ON issue_fix_notices (andon_issue_id) WHERE acknowledged_at IS NULL;
