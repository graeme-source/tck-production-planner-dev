-- Per-user feature grants with an optional SOP-training gate.
-- Access = granted AND (gate off OR no required SOP OR trained sign-off).
-- Gate switch lives in app_settings under feature_sop_gate_enforced
-- (absent/false = off — Graeme wants grants live immediately, training
-- enforcement switch-on-able later). Pilot feature: APC label printing.

CREATE TABLE IF NOT EXISTS app_features (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  required_sop_id integer REFERENCES risk_assessments(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature_grants (
  id serial PRIMARY KEY,
  feature_key text NOT NULL REFERENCES app_features(key) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  granted_by integer,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_feature_grant UNIQUE (feature_key, user_id)
);

INSERT INTO app_features (key, name, description) VALUES
  ('apc_label_printing',
   'APC label printing (Order Packing Live)',
   'Access to the Order Packing Live screen: scanning, booking and printing APC labels. Grants this page to users whose role would not otherwise see it.')
ON CONFLICT (key) DO NOTHING;
