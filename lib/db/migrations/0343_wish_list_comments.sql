-- Comments on Wish List items (Graeme, 28 Oct 2026: "comment on these items.
-- Make sure the comments are hidden, but you can see if there's a comment.
-- If someone gets a notification saying someone's commenting on your
-- wishlist item, it takes [them there] so they can read it"). Objective H.
--
-- Anyone signed in can read and add comments (the list itself is open to
-- everyone). The list shows only a count per item; the thread opens on tap.
-- A new comment notifies the person who asked for the item and everyone who
-- has commented before (never the writer) — the bell row carries the item
-- id so it opens that item's comments.

CREATE TABLE IF NOT EXISTS wish_list_comments (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES wish_list_items(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  user_name TEXT,
  comment TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wish_list_comments_item_idx ON wish_list_comments (item_id, created_at);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS wish_list_item_id INTEGER REFERENCES wish_list_items(id) ON DELETE CASCADE;
