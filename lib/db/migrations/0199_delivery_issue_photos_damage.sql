-- Delivery issues reported with photos: short shelf life + damaged / broken
-- (Graeme, 2026-10-16). Objective D (goods-in checks every time), and C
-- (stock stays right — rejected damage isn't booked in).
--
-- "Today 8 bags of chicken with use-by the 17th came in; I took one picture
-- of all 8 bags showing the date and sent it to the account manager James.
-- Make that the process." And the same for broken or damaged items.
--
--   delivery_issue_photos
--       photos taken at goods-in of every affected item (use-by dates /
--       damage showing). Compressed JPEG bytes in Postgres, like incident
--       and andon attachments. Up to 4 per receive; at least one is required
--       (enforced by the receive endpoint) whenever a receive has a new
--       issue line. Attached to the supplier email.
--   delivery_damage_reports
--       one row per PO line marked Damaged / broken: how many, the note,
--       kept or rejected, who/when, the photos, and the email to the
--       supplier (same statuses as delivery_shelf_life_reports). UNIQUE line
--       id = a re-save never re-sends.
--   delivery_shelf_life_reports.photo_ids / photos_confirmed
--       the photos sent with that report, and the receiver's tick that every
--       affected item was in them.
--
-- The supplier email is now ONE per receive covering every new issue line;
-- each row it covered carries the same email status.
--
-- Idempotent: re-running changes nothing.

CREATE TABLE IF NOT EXISTS delivery_issue_photos (
  id                  SERIAL PRIMARY KEY,
  purchase_order_id   INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  mime                TEXT NOT NULL,
  data                BYTEA NOT NULL,
  size_bytes          INTEGER,
  uploaded_by_id      INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  uploaded_by_name    TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS delivery_issue_photos_po_idx
  ON delivery_issue_photos (purchase_order_id);

CREATE TABLE IF NOT EXISTS delivery_damage_reports (
  id                       SERIAL PRIMARY KEY,
  purchase_order_id        INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  purchase_order_line_id   INTEGER NOT NULL UNIQUE REFERENCES purchase_order_lines(id) ON DELETE CASCADE,
  supplier_id              INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  ingredient_id            INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
  ingredient_name          TEXT NOT NULL,
  quantity                 NUMERIC(12, 4) NOT NULL,
  unit                     TEXT,
  note                     TEXT,
  -- 'kept' (we'll use what we can) | 'rejected' (not received)
  disposition              TEXT NOT NULL,
  delivery_date            DATE NOT NULL,
  reported_by_id           INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  reported_by_name         TEXT,
  reported_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  photo_ids                INTEGER[] NOT NULL DEFAULT '{}',
  photos_confirmed         BOOLEAN NOT NULL DEFAULT FALSE,
  -- 'pending' | 'sent' | 'failed' | 'no_address' | 'skipped'
  email_status             TEXT NOT NULL DEFAULT 'pending',
  email_error              TEXT,
  emailed_to_name          TEXT,
  emailed_to               TEXT,
  emailed_at               TIMESTAMP
);

CREATE INDEX IF NOT EXISTS delivery_damage_reports_po_idx
  ON delivery_damage_reports (purchase_order_id);

ALTER TABLE delivery_shelf_life_reports ADD COLUMN IF NOT EXISTS photo_ids INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE delivery_shelf_life_reports ADD COLUMN IF NOT EXISTS photos_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
