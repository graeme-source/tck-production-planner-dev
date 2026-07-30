-- Merge the four prep-section checklists into one canonical 'prep' checklist.
--
-- Why: the prep area is one physical station, but 'prep' (hub), 'main_prep',
-- 'prep_bases' and 'prep_meat' each carried their own cloned template set and
-- their own completions (local counts 2026-07-30: 221/254/49/11). A tick made
-- in one section never showed in the others — reported as "the checklist is
-- undoing itself". Code fix: SHARED_CHECKLIST_STATIONS now aliases the three
-- section types to 'prep' (artifacts/api-server/src/routes/checklists.ts).
--
-- Data merge, preserving every completion row (HACCP audit trail):
--   1. Alias templates that duplicate a 'prep' template (same category +
--      case/space-insensitive title): move their completions onto the
--      canonical template, earliest tick first; where the same plan was
--      ticked in two sections, the first tick wins and the later row stays
--      on the (deactivated) alias template as history.
--   2. Deactivate those duplicate alias templates.
--   3. Alias templates with no canonical twin move to 'prep' wholesale
--      (their completions follow). Wording drifted between the cloned sets,
--      so a few near-duplicates may now sit side by side — tidy them in the
--      checklist admin panel rather than risking a wrong auto-merge.
--   4. One-off items re-key to 'prep'.
--
-- Applied idempotently at API startup (runStartupMigrations), guarded by
-- _migrations_done key 'prep_checklist_merge_v1'.

DO $$
DECLARE
  r RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'prep_checklist_merge_v1') THEN

    -- 1. Move completions from duplicate alias templates onto the canonical
    --    'prep' template. Earliest completion for a plan wins the unique
    --    (template_id, plan_id) slot; later duplicates stay where they are.
    FOR r IN
      SELECT DISTINCT ON (cc.id) cc.id AS completion_id, cc.plan_id, keep.id AS keep_id
      FROM checklist_completions cc
      JOIN checklist_templates dup
        ON dup.id = cc.template_id
       AND dup.station_type IN ('main_prep', 'prep_bases', 'prep_meat')
      JOIN checklist_templates keep
        ON keep.station_type = 'prep'
       AND keep.category = dup.category
       AND lower(btrim(keep.title)) = lower(btrim(dup.title))
      ORDER BY cc.id, keep.id
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM checklist_completions x
        WHERE x.template_id = r.keep_id AND x.plan_id = r.plan_id
      ) THEN
        UPDATE checklist_completions
        SET template_id = r.keep_id, station_type = 'prep'
        WHERE id = r.completion_id;
      END IF;
    END LOOP;

    -- 2. Deactivate alias templates that have a canonical twin.
    UPDATE checklist_templates dup
    SET is_active = false
    WHERE dup.station_type IN ('main_prep', 'prep_bases', 'prep_meat')
      AND EXISTS (
        SELECT 1 FROM checklist_templates keep
        WHERE keep.station_type = 'prep'
          AND keep.category = dup.category
          AND lower(btrim(keep.title)) = lower(btrim(dup.title))
      );

    -- 3. Unique alias templates move to 'prep' (completions follow the
    --    template id; re-key their station_type for consistency).
    UPDATE checklist_completions cc
    SET station_type = 'prep'
    FROM checklist_templates t
    WHERE t.id = cc.template_id
      AND t.station_type IN ('main_prep', 'prep_bases', 'prep_meat');

    UPDATE checklist_templates
    SET station_type = 'prep'
    WHERE station_type IN ('main_prep', 'prep_bases', 'prep_meat');

    -- 4. One-off items.
    UPDATE checklist_oneoff_items
    SET station_type = 'prep'
    WHERE station_type IN ('main_prep', 'prep_bases', 'prep_meat');

    INSERT INTO _migrations_done (key) VALUES ('prep_checklist_merge_v1');
  END IF;
END $$;
