-- More than one classification on a review, and a "Maternity review"
-- classification (Graeme, 2026-10-12). Objectives H and F.
--
-- "It could be about attendance and timekeeping… we should be [able to
-- tick a] number of classifications."
--
--   • people_record_entry_classifications — the full ticked set for an
--     entry (entry_id, classification_id, position: 0 = the primary).
--     people_record_entries.classification_id stays as the PRIMARY (the
--     first ticked) for anything that reads one; the rules read the set
--     (lib/people-reviews entryClassIds / entryClassification). Backfill:
--     every existing entry gets its current classification as its one link.
--     Additive — nothing on existing entries is changed or removed.
--   • "Maternity review" — a classification like "1:1 / catch-up" (0178):
--     no extra field sets (not disciplinary, no probation fields) and NO
--     attendance evidence, so it never answers an attendance trigger by
--     itself. Seeded once by label; editable like any list value. The AI
--     meeting-notes reader picks from the active list, so it can suggest it.
--
-- Idempotent: re-running changes nothing.

CREATE TABLE IF NOT EXISTS people_record_entry_classifications (
  entry_id          INTEGER NOT NULL REFERENCES people_record_entries(id) ON DELETE CASCADE,
  classification_id INTEGER NOT NULL REFERENCES people_record_classifications(id),
  position          INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entry_id, classification_id)
);

CREATE INDEX IF NOT EXISTS people_record_entry_classifications_class_idx
  ON people_record_entry_classifications(classification_id);

INSERT INTO people_record_entry_classifications (entry_id, classification_id, position)
SELECT e.id, e.classification_id, 0
  FROM people_record_entries e
ON CONFLICT (entry_id, classification_id) DO NOTHING;

INSERT INTO people_record_classifications (label, sort_order, field_sets, evidence)
SELECT 'Maternity review', 26, ARRAY[]::TEXT[], NULL
WHERE NOT EXISTS (SELECT 1 FROM people_record_classifications WHERE lower(label) = lower('Maternity review'));
