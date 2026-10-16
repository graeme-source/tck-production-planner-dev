-- Customer surveys: formatted introduction text and an optional final
-- offer page (Graeme, 2026-10-16). Objective I (customer feedback shapes
-- what we launch): instructions, bold text, lists, fonts and paragraph
-- breaks in the survey intro, shown the same way on the Shopify feedback
-- page; and, where chosen, a "top up?" page after they submit.
--
--   surveys.intro_html
--       the intro as SANITISED HTML from the planner's rich-text editor
--       (allow-list in artifacts/api-server/src/lib/survey-intro.ts; it is
--       sanitised again on every read). Null on older surveys: their
--       plain-text `intro` is turned into paragraphs on the way out.
--       `intro` stays as the plain-text version (derived on save) for the
--       invite email and the current theme code.
--
--   surveys.final_page_enabled ... final_show_offer
--       the final page shown after a successful submit. OFF by default for
--       every survey, old and new (Graeme: "you can choose to include that
--       or not on any given survey"); when off the survey ends as before.
--       final_html is sanitised like intro_html; final_button_url must be
--       http(s) on thecalzonekitchen.co.uk (survey-final-page.ts).
--       final_show_offer = also show this week's offer from the email plan.
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS intro_html text;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS final_page_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS final_heading text;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS final_html text;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS final_button_label text;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS final_button_url text;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS final_show_offer boolean NOT NULL DEFAULT false;
