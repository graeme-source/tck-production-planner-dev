-- Short-delivery reports (Graeme, 2026-10-15). Objectives C (stock stays
-- right) and D (goods-in checks every time).
--
-- "If we're short of anything we ordered, or something wasn't delivered that
-- should have been, send a message to the Production Flow Manager checklist —
-- a little short report … We need to know as soon as possible." Today 8
-- bottles of milk for cinnamon buns were missing from a Brakes delivery.
--
-- When goods-in is completed with lines short or not received, the app puts a
-- one-off item (recurrence {"kind":"once"}) on a team list for that day, and a
-- to-do + bell for chosen people. One row here per delivery, so a re-save
-- sends nothing new and a later quantity edit sends one follow-up:
--
--   purchase_order_id   the delivery (one report per delivery)
--   signature           the shortfall last reported ("lineId:ordered:received|…")
--   team_list_id / team_list_item_id   where the current report sits
--   recipient_ids       people given a to-do about this delivery so far
--
-- Settings (app_settings, managed from the Deliveries page, manager+):
--   short_delivery_team_list_id    which team list gets the reports. Seeded
--                                  ONCE below by looking up the list called
--                                  "Production Flow Manager" — data, not
--                                  logic; the code only ever reads the id.
--   short_delivery_recipient_ids   JSON array of user ids who always get a
--                                  to-do + bell (default none).
--
-- Idempotent: re-running changes nothing.

CREATE TABLE IF NOT EXISTS short_delivery_reports (
  id                  SERIAL PRIMARY KEY,
  purchase_order_id   INTEGER NOT NULL UNIQUE REFERENCES purchase_orders(id) ON DELETE CASCADE,
  signature           TEXT NOT NULL DEFAULT '',
  team_list_id        INTEGER REFERENCES team_lists(id) ON DELETE SET NULL,
  team_list_item_id   INTEGER REFERENCES team_list_items(id) ON DELETE SET NULL,
  recipient_ids       INTEGER[] NOT NULL DEFAULT '{}',
  created_by_id       INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (key, value)
SELECT 'short_delivery_team_list_id', COALESCE((
  SELECT id::text FROM team_lists
  WHERE name = 'Production Flow Manager' AND archived_at IS NULL
  ORDER BY id LIMIT 1
), '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value)
VALUES ('short_delivery_recipient_ids', '[]')
ON CONFLICT (key) DO NOTHING;
