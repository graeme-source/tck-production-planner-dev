-- Contacts directory (Graeme, 2026-10-02). Objective D (despatch: the APC
-- customer-service number on the packing bench at all times) and safety
-- (emergency contacts where people work).
--
-- One place for the phone numbers the team needs — emergency contacts,
-- carriers, service engineers — shown on the stations they matter to.
-- Supplier contact details are NOT copied in here: they already live on
-- the suppliers table and the directory reads them from there.
--
--   category      emergency | carrier | service | supplier | other
--   station_keys  station keys the app already uses (packing, ovens, …);
--                 the contact shows on those stations' Contacts button
--   pinned        also show as a small always-visible chip on those stations
--   use_for       a stable machine key so a feature can find "its" contact
--                 without hard-coding a name or number in code, e.g.
--                 'apc_customer_service' (the APC booking-failure call prompt)
--   Soft delete only (deleted_at), so a mistaken delete can be undone.
CREATE TABLE IF NOT EXISTS contacts (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  organisation     TEXT,
  role             TEXT,
  phone            TEXT,
  email            TEXT,
  notes            TEXT,
  category         TEXT NOT NULL DEFAULT 'other'
                   CHECK (category IN ('emergency', 'carrier', 'service', 'supplier', 'other')),
  station_keys     TEXT[] NOT NULL DEFAULT '{}',
  pinned           BOOLEAN NOT NULL DEFAULT FALSE,
  use_for          TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_by_id    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name  TEXT,
  updated_by_id    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name  TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMP,
  deleted_by_id    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  deleted_by_name  TEXT
);
-- One live contact per machine key.
CREATE UNIQUE INDEX IF NOT EXISTS ux_contacts_use_for ON contacts (use_for)
  WHERE use_for IS NOT NULL AND deleted_at IS NULL;

-- The one contact the APC booking-failure flow needs, pinned on packing.
INSERT INTO contacts (name, organisation, phone, category, station_keys, pinned, use_for, notes, sort_order)
SELECT 'APC Customer Service (Milton Keynes Depot)', 'APC', '01908 586999', 'carrier',
       ARRAY['packing'], TRUE, 'apc_customer_service',
       'Call to check whether a depot restriction (e.g. no Saturday delivery to a postcode) is temporary or permanent.',
       10
WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE use_for = 'apc_customer_service');
