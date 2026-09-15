-- Accident & incident diary for HACCP due diligence (Graeme, 2026-09-11).
-- One row per report: what happened, containment steps as explicit
-- booleans, free-text detail, and a manager signature.
CREATE TABLE IF NOT EXISTS incident_reports (
  id serial PRIMARY KEY,
  kind text NOT NULL DEFAULT 'incident',
  occurred_at timestamp NOT NULL DEFAULT now(),
  title text NOT NULL DEFAULT '',
  location text,
  description text,
  people_involved text,
  injuries text,
  food_safety_impact text,
  immediate_actions text,
  corrective_actions text,
  production_stopped boolean NOT NULL DEFAULT false,
  food_discarded boolean NOT NULL DEFAULT false,
  risk_assessment_done boolean NOT NULL DEFAULT false,
  area_cleaned boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open',
  reported_by_user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  reported_by_name text,
  signed_by_user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  signed_by_name text,
  signed_at timestamp,
  closed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incident_reports_occurred ON incident_reports(occurred_at DESC);
