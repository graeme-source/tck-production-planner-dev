-- The email plan: a weekly offer cycle on the marketing calendar's new
-- List view (Graeme, 2026-10-14: "This attached HTML is a new marketing
-- calendar … the default will be list … we really need to marry those up").
-- Objective I (founder command centre: the whole email plan, and what each
-- email earned, in one place).
--
-- Everything the design hard-coded is DATA here, editable in the app's
-- "Calendar setup" panel (founder):
--
--   marketing_cycle_settings   ONE row (id = 1): the Monday the cycle starts,
--       the weekly plan (which email type goes on Mon..Sun; NULL = no email)
--       and the Saturday free-slot ideas [{idea, subject}], which rotate
--       week by week.
--   marketing_cycle_offers     the offers, in cycle order (position): the
--       campaign-name code ("O1 Free Pack £39.95"), the offer as customers
--       read it, an optional tag ("Standard"), a colour key, whether it
--       features a product of the week ("(Product)" in the texts is filled
--       from that week's product), and a subject-line idea per email type.
--   marketing_cycle_pauses     date ranges where the cycle pauses (Black
--       Friday) — that week's emails come from the planner's own planned
--       emails, and the cycle carries on with the next offer afterwards.
--   marketing_key_dates        UK key dates on the list (big = likely to
--       change that week's offer; the week shows a warning).
--   marketing_cycle_weeks      per week (its Monday): the product added
--       that week, for offers that feature one.
--
-- marketing_emails gains (one email = ONE row, whether it came from the
-- cycle, the planner or Klaviyo):
--   cycle_date     set when the row IS a cycle slot made real (someone wrote
--                  a note, ticked it, linked it, or Klaviyo's campaign name
--                  matched it). One live row per slot day.
--   email_type     launch | follow_up | new_angle | last_call | free_slot |
--                  teaser | extension (NULL = not set).
--   cycle_offer_id the offer it was made from (kept if the offer changes).
--   campaign_name  the suggested Klaviyo campaign name, frozen when the row
--                  was made from a slot (the team pastes it into Klaviyo;
--                  matching is by this name first).
--   skipped        a cycle email someone decided not to send this week.
--
-- Seeded with the design's values (plain INSERTs, each guarded so a re-run
-- adds nothing). New tables + nullable / defaulted columns only; no
-- existing row is changed.

CREATE TABLE IF NOT EXISTS marketing_cycle_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  start_date DATE NOT NULL CHECK (EXTRACT(ISODOW FROM start_date) = 1),
  weekly_plan TEXT[] NOT NULL CHECK (array_length(weekly_plan, 1) = 7),
  free_slot_ideas JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_cycle_offers (
  id SERIAL PRIMARY KEY,
  position INTEGER NOT NULL DEFAULT 0,
  code TEXT NOT NULL CHECK (btrim(code) <> ''),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  tag TEXT,
  colour TEXT NOT NULL DEFAULT 'green',
  features_product BOOLEAN NOT NULL DEFAULT FALSE,
  subjects JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  updated_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_marketing_cycle_offers_live ON marketing_cycle_offers (position, id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS marketing_cycle_pauses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  updated_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,
  CONSTRAINT marketing_cycle_pauses_dates_ck CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS marketing_key_dates (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  big BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_marketing_key_dates_date ON marketing_key_dates (date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS marketing_cycle_weeks (
  week_start DATE PRIMARY KEY CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  product TEXT,
  updated_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE marketing_emails ADD COLUMN IF NOT EXISTS cycle_date DATE;
ALTER TABLE marketing_emails ADD COLUMN IF NOT EXISTS email_type TEXT;
ALTER TABLE marketing_emails ADD COLUMN IF NOT EXISTS cycle_offer_id INTEGER REFERENCES marketing_cycle_offers(id) ON DELETE SET NULL;
ALTER TABLE marketing_emails ADD COLUMN IF NOT EXISTS campaign_name TEXT;
ALTER TABLE marketing_emails ADD COLUMN IF NOT EXISTS skipped BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_emails_email_type_check') THEN
    ALTER TABLE marketing_emails ADD CONSTRAINT marketing_emails_email_type_check CHECK (
      email_type IS NULL OR email_type IN ('launch', 'follow_up', 'new_angle', 'last_call', 'free_slot', 'teaser', 'extension'));
  END IF;
END $$;

-- One live row per cycle slot day.
CREATE UNIQUE INDEX IF NOT EXISTS ux_marketing_emails_cycle_date ON marketing_emails (cycle_date)
  WHERE deleted_at IS NULL AND cycle_date IS NOT NULL;

-- ── Seed: the design's values ─────────────────────────────────────────────
INSERT INTO marketing_cycle_settings (id, start_date, weekly_plan, free_slot_ideas)
VALUES (
  1, '2026-10-12',
  ARRAY['launch', NULL, 'follow_up', 'new_angle', 'last_call', 'free_slot', NULL]::text[],
  '[
    {"idea": "Vote on our next flavour", "subject": "Help us pick our next flavour 🗳️"},
    {"idea": "Events / what''s on", "subject": "This week at The Calzone Kitchen"},
    {"idea": "Behind the scenes", "subject": "How we make every calzone"},
    {"idea": "Customer favourites", "subject": "Our top 5 most-ordered calzones"}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO marketing_cycle_offers (position, code, name, tag, colour, features_product, subjects)
SELECT v.position, v.code, v.name, v.tag, v.colour, v.features_product, v.subjects::jsonb
FROM (VALUES
  (1, 'O1 Free Pack £39.95', 'Free pack on orders over £39.95', 'Standard', 'green', FALSE,
   '{"launch": "Free pack on orders over £39.95", "follow_up": "Your free pack is waiting", "new_angle": "Family night sorted, free pack included", "last_call": "Last call: free pack offer ends today"}'),
  (2, 'O2 £39.95 + (Product)', '£39.95 min spend + (Product) added to free pack options', NULL, 'rust', TRUE,
   '{"launch": "NEW: (Product) added to your free pack options", "follow_up": "Have you tried (Product) yet?", "new_angle": "Why everyone''s picking (Product) as their free pack", "last_call": "Last call: (Product) free pack ends today"}'),
  (3, 'O3 £34.95 + (Product)', '£34.95 min spend + (Product) added to free pack options', NULL, 'plum', TRUE,
   '{"launch": "Now from £34.95: free pack + (Product)", "follow_up": "Spend less, still get (Product) free", "new_angle": "Midweek treat: (Product) on us from £34.95", "last_call": "Last call: free pack + (Product) ends today"}'),
  (4, 'O4 Free Pack £34.95', 'Free pack on orders over £34.95', NULL, 'blue', FALSE,
   '{"launch": "Free pack on orders over £34.95", "follow_up": "Still on: free pack from £34.95", "new_angle": "Weekend plans? Free pack from £34.95", "last_call": "Last call: free pack from £34.95 ends today"}')
) AS v(position, code, name, tag, colour, features_product, subjects)
WHERE NOT EXISTS (SELECT 1 FROM marketing_cycle_offers);

INSERT INTO marketing_cycle_pauses (name, start_date, end_date)
SELECT 'Black Friday', '2026-11-01', '2026-12-04'
WHERE NOT EXISTS (SELECT 1 FROM marketing_cycle_pauses WHERE name = 'Black Friday' AND start_date = '2026-11-01');

INSERT INTO marketing_key_dates (date, name, big)
SELECT v.date::date, v.name, v.big
FROM (VALUES
  ('2026-10-25', 'Clocks go back', FALSE),
  ('2026-10-31', 'Halloween', FALSE),
  ('2026-11-01', 'National Calzone Day (US)', FALSE),
  ('2026-11-05', 'Bonfire Night', FALSE),
  ('2026-11-08', 'Remembrance Sunday', FALSE),
  ('2026-11-27', 'Black Friday', TRUE),
  ('2026-11-30', 'Cyber Monday', TRUE),
  ('2026-12-24', 'Christmas Eve', FALSE),
  ('2026-12-25', 'Christmas Day', TRUE),
  ('2026-12-26', 'Boxing Day', TRUE),
  ('2026-12-31', 'New Year''s Eve', FALSE),
  ('2027-01-01', 'New Year''s Day', FALSE),
  ('2027-01-18', 'Blue Monday', FALSE),
  ('2027-01-25', 'Burns Night', FALSE),
  ('2027-02-09', 'Pancake Day', FALSE),
  ('2027-02-14', 'Valentine''s Day', FALSE),
  ('2027-03-07', 'Mother''s Day (UK)', FALSE),
  ('2027-03-26', 'Good Friday (bank holiday)', FALSE),
  ('2027-03-28', 'Easter Sunday · clocks go forward', FALSE),
  ('2027-03-29', 'Easter Monday (bank holiday)', FALSE),
  ('2027-05-03', 'Early May bank holiday', FALSE),
  ('2027-05-31', 'Spring bank holiday', FALSE),
  ('2027-06-20', 'Father''s Day', FALSE),
  ('2027-08-30', 'Summer bank holiday', FALSE)
) AS v(date, name, big)
WHERE NOT EXISTS (SELECT 1 FROM marketing_key_dates k WHERE k.date = v.date::date AND k.name = v.name);
