-- "Something else…" on Report defect / waste (Graeme, 21 Oct 2026).
-- Objective F (quality and waste recorded truthfully, so it can be reduced).
--
-- "We can't type a custom 'What went wrong'. Today the wrong recipe was made
-- and we've got to discard a load of extra dough, but there's no relevant
-- option."
--
-- 1) defect_types.asks_for_detail — a type whose records must say in words
--    what went wrong. The form shows a text box when it's picked, the
--    server requires the text, and the form always lists these types last.
--    A flag, not a name, so admins can still rename the type freely.
ALTER TABLE defect_types ADD COLUMN IF NOT EXISTS asks_for_detail BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) defects.reason_other — what was typed for such a type (3–200 chars,
--    checked by the API). NULL for every other record. Kept apart from
--    `note` so the reason can be read and grouped on its own.
ALTER TABLE defects ADD COLUMN IF NOT EXISTS reason_other TEXT;
ALTER TABLE defects DROP CONSTRAINT IF EXISTS defects_reason_other_length;
ALTER TABLE defects ADD CONSTRAINT defects_reason_other_length
  CHECK (reason_other IS NULL OR char_length(reason_other) <= 200);

-- 3) Three production reasons, only if nothing equivalent is there already
--    (types are admin-editable data, so match loosely, as 0152 did).
INSERT INTO defect_types (name, sort_order)
SELECT 'Made wrong / wrong recipe', COALESCE(MAX(sort_order), 0) + 10 FROM defect_types
WHERE NOT EXISTS (SELECT 1 FROM defect_types WHERE name ILIKE '%wrong recipe%' OR name ILIKE '%made wrong%')
ON CONFLICT DO NOTHING;

INSERT INTO defect_types (name, sort_order)
SELECT 'Made too much / overproduced', COALESCE(MAX(sort_order), 0) + 10 FROM defect_types
WHERE NOT EXISTS (SELECT 1 FROM defect_types WHERE name ILIKE '%overproduc%' OR name ILIKE '%too much%')
ON CONFLICT DO NOTHING;

-- The right recipe, but quantities weighed wrong so the batch came out
-- inaccurate (Graeme, 21 Oct) — kept apart from "made wrong".
INSERT INTO defect_types (name, sort_order)
SELECT 'Weighing mistake / inaccurate recipe', COALESCE(MAX(sort_order), 0) + 10 FROM defect_types
WHERE NOT EXISTS (SELECT 1 FROM defect_types WHERE name ILIKE '%weigh%')
ON CONFLICT DO NOTHING;

-- 4) The free-text reason, last. A type already called that is reused.
UPDATE defect_types SET asks_for_detail = TRUE, updated_at = NOW()
WHERE lower(name) = 'something else'
  AND NOT EXISTS (SELECT 1 FROM defect_types WHERE asks_for_detail);
INSERT INTO defect_types (name, sort_order, asks_for_detail)
SELECT 'Something else', COALESCE(MAX(sort_order), 0) + 10, TRUE FROM defect_types
WHERE NOT EXISTS (SELECT 1 FROM defect_types WHERE asks_for_detail)
ON CONFLICT DO NOTHING;
