-- SOP links: attach an SOP to the places work actually happens — checklist
-- items, ingredients (globally or per recipe), recipes, stations. Target
-- shapes: checklist_template(a=template id) · ingredient(a=ingredient id) ·
-- recipe_ingredient(a=recipe id, b=ingredient id — overrides/augments the
-- ingredient-level link inside that recipe) · recipe(a=recipe id) ·
-- station(target_text=station key). Raw SQL like the sops tables themselves.
CREATE TABLE IF NOT EXISTS sop_links (
  id SERIAL PRIMARY KEY,
  sop_id INTEGER NOT NULL REFERENCES standards_sops(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_a INTEGER,
  target_b INTEGER,
  target_text TEXT,
  created_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sop_links_dedupe
  ON sop_links (sop_id, target_type, COALESCE(target_a, 0), COALESCE(target_b, 0), COALESCE(target_text, ''));
CREATE INDEX IF NOT EXISTS ix_sop_links_target ON sop_links (target_type, target_a);
