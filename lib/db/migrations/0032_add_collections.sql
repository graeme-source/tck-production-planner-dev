-- Migration: collections — goods leaving the unit, the mirror of a delivery
--
-- A driver arrives to collect something (returnable containers, equipment going
-- for repair, samples). The team ticks off what's handed over, captures the
-- driver's signature on the iPad, and optionally photographs the items with the
-- driver or in the vehicle.
--
-- Nesting inside a delivery is DERIVED at query time from (supplier_id, date)
-- matching a purchase order's (supplier_id, expected_delivery_date) — not a
-- stored FK. Moving the delivery to another day then cleanly detaches the
-- collection into a standalone card rather than leaving a stale pointer.
--
-- Applied idempotently at API startup (runStartupMigrations) as well.

CREATE TABLE IF NOT EXISTS collections (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  collection_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  reference TEXT,
  notes TEXT,
  driver_name TEXT,
  signature_blob BYTEA,
  signature_mime TEXT,
  photo_blob BYTEA,
  photo_mime TEXT,
  collected_at TIMESTAMP,
  collected_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  collected_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_collections_supplier_date ON collections (supplier_id, collection_date);
CREATE INDEX IF NOT EXISTS ix_collections_date ON collections (collection_date);

CREATE TABLE IF NOT EXISTS collection_lines (
  id SERIAL PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'items',
  checked_off BOOLEAN NOT NULL DEFAULT FALSE,
  quantity_collected NUMERIC(10,2),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_collection_lines_collection ON collection_lines (collection_id);
