-- Weekly lean focus (2026-08-02, Graeme): "one lesson per week — focus on
-- one thing Monday to Friday, and let me choose next week's focus if I
-- want; otherwise follow the curriculum."
--
-- lean_week_focus pins a week (Monday date) to a chosen lean_principles
-- row. The daily lesson picker (getTodayPrincipleAndExample) resolves the
-- week's principle — override row first, else the active curriculum walked
-- one principle per week from the lean_curriculum_start_date anchor — and
-- rotates that principle's examples across the weekdays, so the theme
-- holds all week while the material still varies day to day. (History:
-- an every-example-per-day rotation replaced an older weekday cycler that
-- repeated a small pool; this keeps both fixed.)
--
-- Also renames principle "The 8 Wastes — DOWNTIME" → "The 8 Wastes":
-- DOWNTIME is the generic acronym (whose N is "non-utilised talent");
-- the team's canon is Lean Made Simple (Ryan Tierney), which names that
-- waste "Waste of Skills". Terminology lives in
-- artifacts/api-server/src/lib/lean-corpus.ts.
--
-- Applied idempotently at API startup (runStartupMigrations).

CREATE TABLE IF NOT EXISTS lean_week_focus (
  week_start DATE PRIMARY KEY,
  principle_id INTEGER NOT NULL REFERENCES lean_principles(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

UPDATE lean_principles SET title = 'The 8 Wastes'
WHERE title = 'The 8 Wastes — DOWNTIME';

UPDATE lean_principles
SET summary = 'Overproduction, Transportation, Inventory, Defects, Motion, Overprocessing, Waiting, Waste of Skills.'
WHERE title = 'The 8 Wastes' AND summary ~* 'non.?utili[sz]ed';
