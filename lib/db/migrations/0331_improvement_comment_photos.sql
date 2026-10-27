-- Comments & photos on an improvement — a timeline under every card
-- (Graeme, 27 Oct 2026; Objective E): "make it so I can comment on
-- improvements and also post photos, like a bit of a timeline."
--
-- A photo posted in the conversation is stored exactly like every other
-- improvement photo (bytea in improvement_attachments, served from
-- /api/improvements/attachments/:id), but it belongs to the comment it was
-- posted with. comment_id says so:
--
--   * NULL     — the improvement's own evidence (before / after / stitched),
--                as before. Only these count towards "needs a photo", the
--                auto-submit on the after photo, the feed media, the SOP
--                copy and the morning check-in card.
--   * not NULL — a photo in the conversation. Deleting the comment takes
--                its photo with it (CASCADE).
--
-- A photo posted with no words is a comment whose text is empty.
-- Running it twice changes nothing.

ALTER TABLE improvement_attachments
  ADD COLUMN IF NOT EXISTS comment_id INTEGER REFERENCES improvement_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS ix_improvement_attachments_comment
  ON improvement_attachments (comment_id) WHERE comment_id IS NOT NULL;

-- The list endpoint counts comments for every card in one query.
CREATE INDEX IF NOT EXISTS ix_improvement_comments_improvement
  ON improvement_comments (improvement_id, created_at);
