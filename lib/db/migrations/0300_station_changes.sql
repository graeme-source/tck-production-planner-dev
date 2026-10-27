-- Station changes: "What's changed in this station?" (Graeme, 27 Oct 2026).
-- "When we add a feature all we do is put it into the list in the
-- improvements slide... People don't know new features are there because
-- there's a button added and they don't see it." Objectives E, F and H.
--
-- 1. change_areas: the parts of the business a change can affect — every
--    station, production planning, and the office (sales, marketing,
--    finance, people, behind-the-scenes). DATA, not code: the meeting slide
--    and station screens read this table, and the hints drive the
--    best-guess tagging (lib/station-changes guessAreas).
-- 2. system_updates gains areas (which of the above), an optional
--    walkthrough (tutorial JSON, validated by lib/station-changes
--    parseTutorial) and a slug so seeded entries are idempotent.
-- 3. system_update_seen: who has seen which change (per PERSON — station
--    iPads switch person with a PIN), for the "N new" badges.

-- Created at startup by runStartupMigrations too; repeated here so this file
-- stands on its own on a fresh database.
CREATE TABLE IF NOT EXISTS system_updates (
  id serial PRIMARY KEY,
  title text,
  body text NOT NULL,
  published boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS change_areas (
  key TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('station', 'planning', 'office')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Station screens (route keys) whose "What's changed?" shows this area.
  station_types TEXT[] NOT NULL DEFAULT '{}',
  applies_to_all_stations BOOLEAN NOT NULL DEFAULT false,
  -- Lower-case path substrings / words for the best-guess tagger.
  path_hints TEXT[] NOT NULL DEFAULT '{}',
  word_hints TEXT[] NOT NULL DEFAULT '{}'
);

INSERT INTO change_areas (key, label, kind, sort_order, station_types, applies_to_all_stations, path_hints, word_hints) VALUES
  ('all_stations', 'Every station', 'station', 5, '{}', true,
    '{pages/station/shared/station-layout,pages/station/shared/checklist,pages/station/shared/break-,components/station-changes,components/tutorial,quality-rejects-control,report-defect}',
    '{every station,all stations,station menu,station top bar,break screen,report defect,checklists}'),
  ('goods_in', 'Front Door & goods-in', 'station', 10, '{}', false,
    '{goods-in,pages/deliveries,visitor-check-in,unexpected-deliver}',
    '{goods-in,goods in,front door,delivery card,receiving,receive line}'),
  ('dough_prep', 'Dough Prep', 'station', 20, '{dough_prep}', false,
    '{dough-prep-station}',
    '{dough prep,bun dough,billets,balling}'),
  ('dough_sheeting', 'Dough Sheeting', 'station', 25, '{dough_sheeting}', false,
    '{dough-sheeting-station}',
    '{dough sheeting,sheeting}'),
  ('macaroni_cheese', 'Macaroni Cheese', 'station', 30, '{macaroni_cheese}', false,
    '{macaroni-cheese-station}',
    '{macaroni cheese station,mac cheese station}'),
  ('fried_chicken', 'Fried Chicken', 'station', 35, '{fried_chicken}', false,
    '{fried-chicken-station,components/fried-chicken}',
    '{fried chicken station}'),
  ('prep', 'Prep', 'station', 40, '{prep,main_prep,prep_bases,prep_meat}', false,
    '{stations/prep-hub,prep-section-tabs,prep-helpers,station-stock-checks,stock-check-entry,stock-check-status,prep-labels,prep-tin-labels}',
    '{prep screens,prep station,prep labels,prep tabs,stock check,stock checks}'),
  ('main_prep', 'Main Prep', 'station', 41, '{main_prep}', false,
    '{main-prep-station}',
    '{main prep}'),
  ('prep_bases', 'Bases & Sauces', 'station', 42, '{prep_bases}', false,
    '{prep-bases-station,sub-recipe-pot-labels}',
    '{bases & sauces,bases and sauces,pot labels,garlic mayo}'),
  ('prep_meat', 'Raw Meat Prep', 'station', 43, '{prep_meat}', false,
    '{prep-meat-station}',
    '{raw meat,raw meat prep}'),
  ('mixing', 'Mixing & Cooking', 'station', 50, '{mixing}', false,
    '{mixing-station,mixing-cooking}',
    '{mixing,mixing queue,cook temps}'),
  ('building', 'Building', 'station', 60, '{building_1,building_2}', false,
    '{building-station,building-edit,building-complete,assembly-groups,building-table}',
    '{building,builders,building table}'),
  ('ovens', 'Ovens', 'station', 70, '{ovens}', false,
    '{ovens-station,ovens-blast-tray,oven-reminder}',
    '{ovens,oven queue}'),
  ('wrapping', 'Wrapping', 'station', 80, '{wrapping}', false,
    '{wrapping-station,front-labels-dialog,back-labels}',
    '{wrapping,front labels,back labels,wonky rack}'),
  ('packing', 'Packing', 'station', 90, '{packing}', false,
    '{pages/fulfilment,packing-station,five-pack-labels,desserts-report-card,pages/scan}',
    '{packing,packers,order packing live,5-pack,pack list}'),
  ('planning', 'Production planning', 'planning', 100, '{}', false,
    '{production-plans,pages/orders,routes/orders,create-plan,stock-control,pages/recipes,sub-recipes,factory-forecast,lib/production-schedule,stock-prediction,short-on-the-pack,meeting}',
    '{create plan,edit plan,orders page,ordering,stock control,factory forecast,recipe editor,morning meeting}'),
  ('office', 'Office & behind the scenes', 'office', 200, '{}', false,
    '{finance,founder,marketing,klaviyo,payroll,cash-flow,people,pages/sales,founder-sales,ad-spend,ad-efficiency,meta-ads,surveys,test-box,contracts,docs/,scripts/,tools/,api-spec,api-zod}',
    '{cash flow,payroll,marketing,klaviyo,roas,sales,finance,people record,contracts,survey,test box,a/b test}')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE system_updates ADD COLUMN IF NOT EXISTS areas TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE system_updates ADD COLUMN IF NOT EXISTS tutorial JSONB;
ALTER TABLE system_updates ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS system_updates_slug_key ON system_updates (slug);
CREATE INDEX IF NOT EXISTS system_updates_created_at_idx ON system_updates (created_at DESC);

CREATE TABLE IF NOT EXISTS system_update_seen (
  update_id INTEGER NOT NULL REFERENCES system_updates(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (update_id, user_id)
);
CREATE INDEX IF NOT EXISTS system_update_seen_user_idx ON system_update_seen (user_id);
