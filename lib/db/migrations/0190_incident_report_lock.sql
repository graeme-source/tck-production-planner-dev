-- Lock signed accident & incident reports, with an audited unlock
-- (Graeme, 2026-10-13: "we do want to lock signed incident reports, but we
-- want to be able to unlock them and update them or add stuff to them").
-- Objective B: the diary is HACCP evidence — a signature must mean the
-- wording can't quietly change afterwards, and every change after signing
-- must leave a trail.
--
--   incident_reports.signed_version   how many times it has been signed
--                                     (0 = never). Each signature is a
--                                     version: v1, v2, …
--   incident_reports.unlocked_*       set while a manager has unlocked a
--                                     signed report to update it; cleared
--                                     when it is signed again. A report is
--                                     LOCKED when signed_at is set and
--                                     unlocked_at is null (enforced by the
--                                     API: edits get a 409).
--   incident_report_history           one row per signature ('signed', with
--                                     a JSON snapshot of the wording as
--                                     signed) and per unlock ('unlocked',
--                                     who/when/why, snapshot of the version
--                                     being unlocked). Never deleted — the
--                                     original signed wording is always kept.
--
-- Backfill: every report already signed becomes signed v1, with a history
-- row holding its current wording (which is what was signed — there was
-- no unlock before this migration).
--
-- Idempotent: re-running changes nothing.

ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS signed_version      integer NOT NULL DEFAULT 0;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS unlocked_at         timestamp;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS unlocked_by_user_id integer REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS unlocked_by_name    text;
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS unlock_reason       text;

CREATE TABLE IF NOT EXISTS incident_report_history (
  id             serial PRIMARY KEY,
  incident_id    integer NOT NULL REFERENCES incident_reports(id) ON DELETE RESTRICT,
  event          text NOT NULL,              -- 'signed' | 'unlocked'
  version        integer NOT NULL,           -- the signed version this event is about
  snapshot       jsonb NOT NULL,             -- the report's wording and fields at that version
  actor_user_id  integer REFERENCES app_users(id) ON DELETE SET NULL,
  actor_name     text,
  reason         text,                       -- why it was unlocked
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_incident_report_history_incident ON incident_report_history (incident_id, created_at, id);

UPDATE incident_reports SET signed_version = 1 WHERE signed_at IS NOT NULL AND signed_version = 0;

-- Snapshot keys match snapshotIncident() in
-- artifacts/api-server/src/lib/incident-lock-rules.ts. incident_reports
-- timestamps are stored as UTC (Drizzle timestamp without time zone), so
-- the ISO string carries a Z like Date.toISOString().
INSERT INTO incident_report_history (incident_id, event, version, snapshot, actor_user_id, actor_name, created_at)
SELECT r.id, 'signed', 1,
       jsonb_build_object(
         'kind', r.kind,
         'occurredAt', to_char(r.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'title', r.title,
         'location', r.location,
         'description', r.description,
         'peopleInvolved', r.people_involved,
         'injuries', r.injuries,
         'foodSafetyImpact', r.food_safety_impact,
         'immediateActions', r.immediate_actions,
         'correctiveActions', r.corrective_actions,
         'productionStopped', r.production_stopped,
         'foodDiscarded', r.food_discarded,
         'riskAssessmentDone', r.risk_assessment_done,
         'areaCleaned', r.area_cleaned
       ),
       r.signed_by_user_id, r.signed_by_name, r.signed_at AT TIME ZONE 'UTC'
FROM incident_reports r
WHERE r.signed_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM incident_report_history h WHERE h.incident_id = r.id AND h.event = 'signed');
