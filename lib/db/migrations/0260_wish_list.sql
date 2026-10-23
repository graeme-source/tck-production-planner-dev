-- Wish List — "Equipment & things we need" (Graeme, 23 Oct 2026).
-- Objective E (team).
--
-- Anyone on the team pastes a link (or types what they need) from Quick
-- actions; everyone can +1 it once per London day, so the list shows the
-- biggest pain point. The founder and admins get a must-dismiss pop-up
-- whenever something new is added.
--
--   wish_list_items        one thing someone wants. url is stored CLEAN
--                          (tracking parameters such as utm_*, gclid,
--                          gbraid removed). Prices in pence;
--                          price_includes_vat says which way the shop
--                          quoted it (null = the page didn't say), and
--                          price_ex_vat_pence holds the net price when the
--                          shop gave both. deleted_at = soft delete.
--   wish_list_votes        one row per person per item per London day
--                          (UNIQUE). Adding an item counts as the
--                          requester's first vote.
--   wish_list_alert_acks   how far each founder/admin has acknowledged the
--                          "something's been added" pop-up (highest item
--                          id seen).
--
-- Rules (votes, duplicates, link cleaning, page reading):
-- api-server lib/wish-list.ts. Read/written by routes/wish-list.ts.

CREATE TABLE IF NOT EXISTS wish_list_items (
  id                   SERIAL PRIMARY KEY,
  url                  TEXT,
  title                TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  price_pence          INTEGER CHECK (price_pence IS NULL OR price_pence >= 0),
  price_includes_vat   BOOLEAN,
  price_ex_vat_pence   INTEGER CHECK (price_ex_vat_pence IS NULL OR price_ex_vat_pence >= 0),
  currency             TEXT NOT NULL DEFAULT 'GBP',
  image_url            TEXT,
  store_name           TEXT,
  notes                TEXT,
  quantity             INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  status               TEXT NOT NULL DEFAULT 'requested'
                       CHECK (status IN ('requested', 'approved', 'ordered', 'received', 'declined')),
  status_note          TEXT,
  status_changed_at    TIMESTAMP,
  status_changed_by_name TEXT,
  ordered_at           TIMESTAMP,
  ordered_by_user_id   INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  ordered_by_name      TEXT,
  received_at          TIMESTAMP,
  created_by_user_id   INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name      TEXT,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMP,
  deleted_by_name      TEXT
);

CREATE INDEX IF NOT EXISTS wish_list_items_live_idx
  ON wish_list_items (deleted_at, status);

CREATE TABLE IF NOT EXISTS wish_list_votes (
  id          SERIAL PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES wish_list_items(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  vote_date   DATE NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT wish_list_votes_once_a_day UNIQUE (item_id, user_id, vote_date)
);

CREATE INDEX IF NOT EXISTS wish_list_votes_item_idx ON wish_list_votes (item_id);

CREATE TABLE IF NOT EXISTS wish_list_alert_acks (
  user_id           INTEGER PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  acked_up_to_id    INTEGER NOT NULL DEFAULT 0,
  acked_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
