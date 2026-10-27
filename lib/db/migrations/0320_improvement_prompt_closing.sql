-- "Have you made an improvement today?" on every closing checklist
-- (Graeme, 27 Oct 2026). Objectives E and H.
--
--   "I want to add an optional item to everyone's checklist ... at the end
--    of their closing checklist: 'Have you made an improvement today?' You
--    just put yes or no. ... If they haven't, they just put no and keep it
--    all positive."
--
-- 1. improvement_prompt_answers — one row per person per London day: their
--    yes/no, and the improvement they logged (or pointed at) when yes. The
--    (user_id, day) key means answering again just changes the answer, and
--    two devices answering at once is harmless.
--
-- 2. A checklist item of type 'improvement_prompt' added as the LAST closing
--    item of every station that has a closing checklist — only where the
--    station has no improvement_prompt item yet (active or removed), so a
--    station that removed it never gets it back and running this twice adds
--    nothing. Alias stations (building_2 reads building_1's checklist; the
--    prep sections read 'prep') are skipped: they never show their own rows
--    (lib/checklist-stations.ts).
--
-- The item is optional: it never counts towards the done/total, never
-- blocks a checklist, and is never listed as missed on the HACCP report
-- (lib/checklist-optional.ts).

CREATE TABLE IF NOT EXISTS improvement_prompt_answers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  answer TEXT NOT NULL CHECK (answer IN ('yes', 'no')),
  improvement_id INTEGER REFERENCES improvement_submissions(id) ON DELETE SET NULL,
  station_type TEXT,
  plan_id INTEGER REFERENCES production_plans(id) ON DELETE SET NULL,
  template_id INTEGER REFERENCES checklist_templates(id) ON DELETE SET NULL,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_improvement_prompt_answer UNIQUE (user_id, day)
);

CREATE INDEX IF NOT EXISTS improvement_prompt_answers_day_idx ON improvement_prompt_answers (day);

INSERT INTO checklist_templates
  (station_type, category, title, description, schedule, order_position, dynamic_data_type, is_active)
SELECT t.station_type,
       'closing',
       'Have you made an improvement today?',
       'Optional. Tap Yes to log it, or No — tomorrow''s another chance.',
       'daily',
       MAX(t.order_position) + 1,
       'improvement_prompt',
       TRUE
  FROM checklist_templates t
 WHERE t.category = 'closing'
   AND t.is_active
   AND t.station_type NOT IN ('building_2', 'main_prep', 'prep_bases', 'prep_meat')
   AND NOT EXISTS (
     SELECT 1 FROM checklist_templates x
      WHERE x.station_type = t.station_type
        AND x.dynamic_data_type = 'improvement_prompt'
   )
 GROUP BY t.station_type;
