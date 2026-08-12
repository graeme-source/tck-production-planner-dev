import app from "./app";
import { db, usersTable } from "@workspace/db";
import { sql, count } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { startBackupScheduler, runBackup } from "./lib/backup";
import { LOCATION_DEFS } from "./lib/storage-location-defs";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function seedStorageLocations() {
  // Seed the built-in fridges only on a brand-new install (empty table).
  // Users can now delete any location, so re-inserting missing rows on
  // every boot would resurrect fridges they'd deliberately removed.
  // Seeded straight from LOCATION_DEFS with def_key set — the stable
  // identity used everywhere instead of matching by name.
  const existing = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM storage_locations`);
  const count = Number((existing.rows ?? existing)[0]?.count ?? 0);
  if (count > 0) return;

  for (const def of LOCATION_DEFS) {
    await db.execute(sql`
      INSERT INTO storage_locations (name, zone, is_system, def_key)
      VALUES (${def.label}, ${def.zone}, TRUE, ${def.key})
    `);
  }
}

// The canonical Jewellery & Body Piercings Policy text, seeded once into
// risk_assessments (type 'policy'). After seeding, the DB row is the live
// document — edits happen there via the Documents admin UI, not here.
const JEWELLERY_POLICY_MARKDOWN = `**Applies to:** all employees, agency workers, contractors, managers and visitors entering production, ingredient-storage or packing areas. Compliance is checked before entry into production.

## Why we have this policy

Jewellery can harbour bacteria and can fall into open food as a foreign body. TCK produces 800–1,000 portions of open, unpackaged food five days a week, so we follow a standard that is stricter than the bare legal minimum, in line with FSA guidance and the expectations of food-manufacturing certification schemes such as SALSA and BRCGS.

## The rule

No jewellery or exposed body piercings may be worn in production, ingredient-storage or packing areas. This includes:

- Watches, smartwatches and fitness trackers
- Bracelets, necklaces and chains
- Earrings, including studs, hoops and ear gauges
- Nose, eyebrow, lip and other facial piercings
- Rings, except one plain wedding band
- Any jewellery containing stones, gems, beads or detachable components

## Permitted exceptions

1. **One smooth, plain wedding band** without stones or engraving that makes it difficult to clean. Management may require it to be removed where it could interfere with effective handwashing, damage gloves or create another contamination risk — in direct food-handling roles wearing gloves, no hand jewellery is permitted.
2. **Essential medical-alert jewellery**, following a documented risk assessment and secure containment.
3. **Religious jewellery that cannot reasonably be removed**, following a documented risk assessment and complete containment beneath clothing.

## Piercings that cannot be removed

Exposed jewellery and body piercings are not permitted in open-food production areas unless specifically authorised following a documented food-safety risk assessment. We apply this hierarchy:

1. If a piercing can reasonably be removed, it must be removed before entering production.
2. If it is genuinely non-removable, it must be declared to management and individually risk-assessed.
3. It may only remain where it can be completely and securely contained beneath suitable protective clothing (for example, an ear piercing fully contained by a hairnet), and must not have loose, detachable or damaged components.
4. Where an exposed item (such as a dermal anchor or facial stud) cannot be securely contained, the person must not handle open food or work above exposed product until it can be removed.
5. Any approved exception is recorded on the jewellery-exception register and checked at the start and end of each shift. Loose, damaged or missing items must be reported immediately.

We do not routinely cover facial piercings with plasters — a plaster can itself detach and become a foreign body. Removal or complete containment always comes first.

## New piercings

Employees planning a new piercing that cannot be removed during healing must discuss it with management beforehand. Where the piercing would remain exposed, the employee may be temporarily reassigned away from open-food production for the healing period.

## Long-standing piercings — how we assess them

If you already have piercings you have worn for years, you will not lose your job over this policy. Declare them privately to management, and each will be classified by actual contamination risk:

- **Low risk** (for example a small, secure stud fully enclosed beneath a hairnet, or a piercing under clothing): permitted under a documented exception with the controls above.
- **Medium risk** (for example exposed ear piercings): improved containment, such as a company-issued head covering that fully covers the ears.
- **Higher risk** (exposed facial jewellery over open food, particularly hoops, bars, stones or anything loose): replacement with a secure retainer, removal during the shift, or reassignment to duties away from open product.

Anything connected to religion, belief, disability or medical need will be individually considered and reasonably accommodated before any decision is made.

## Compliance

These requirements apply equally to owners, managers, employees, agency workers, contractors and visitors. Formal disciplinary procedures apply only where an employee refuses to follow controls that have been agreed through the process above.`;

async function runStartupMigrations() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_invites (
        id SERIAL PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        invited_by_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        invited_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        accepted_at TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recipe_chat_threads (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New conversation',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recipe_chat_messages (
        id SERIAL PRIMARY KEY,
        thread_id INTEGER NOT NULL REFERENCES recipe_chat_threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_recipe_chat_messages_thread ON recipe_chat_messages (thread_id, id)`);
    // Caz opened to all staff — threads become private per user. Existing rows
    // predate this and were all the founder's, so backfill them to that user.
    await db.execute(sql`ALTER TABLE recipe_chat_threads ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE`);
    await db.execute(sql`
      UPDATE recipe_chat_threads SET user_id = (SELECT id FROM app_users WHERE email = 'graeme@thecalzonekitchen.co.uk' LIMIT 1)
      WHERE user_id IS NULL
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_recipe_chat_threads_user ON recipe_chat_threads (user_id, updated_at DESC)`);
    // Recipe dietary category (meat / vegetarian) — drives oven-defaults overlay.
    await db.execute(sql`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS dietary_category TEXT`);
    // Seed oven-defaults app_settings keys (sane starting values; admin edits in Settings).
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at) VALUES
        ('oven_meat_temp_c', '220', NOW()),
        ('oven_meat_time_min', '8', NOW()),
        ('oven_veg_temp_c', '210', NOW()),
        ('oven_veg_time_min', '7', NOW())
      ON CONFLICT (key) DO NOTHING
    `);
    // Add fulfilled_at to dispatch_orders if missing (added in v1.1)
    await db.execute(sql`
      ALTER TABLE dispatch_orders ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMP
    `);
    // Backfill fulfilled_at for already-fulfilled rows
    await db.execute(sql`
      UPDATE dispatch_orders SET fulfilled_at = created_at WHERE status = 'fulfilled' AND fulfilled_at IS NULL
    `);
    // Seed apc_test_mode default if not already present
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('apc_test_mode', 'false', NOW())
      ON CONFLICT (key) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('admin_plan_date_override', 'false', NOW())
      ON CONFLICT (key) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('may_contain_statement', 'May also contain traces of nuts, peanuts, egg, soya, celery, sulphites, mustard, wheat and milk', NOW())
      ON CONFLICT (key) DO NOTHING
    `);
    // Appended after the deck + allergen statement when pushing ingredient
    // decks to the Shopify website (custom.ingredient_deck metafield).
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('legal_disclaimer_statement', 'Ingredients and Allergens for all of our products can be found on our website however, from time to time ingredients do vary and subsequently, we ask you to always check the packaging for a complete and accurate list of ingredients and allergens before consuming our products.', NOW())
      ON CONFLICT (key) DO NOTHING
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS postcode_validations (
        id SERIAL PRIMARY KEY,
        shopify_order_id BIGINT NOT NULL,
        postcode TEXT NOT NULL,
        service_code TEXT NOT NULL,
        available BOOLEAN NOT NULL,
        reason TEXT,
        checked_at TIMESTAMP NOT NULL DEFAULT NOW(),
        dispatch_tag TEXT,
        UNIQUE(shopify_order_id, service_code)
      )
    `);
    // Bundle calculator — saved product bundles + their line items.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS bundles (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        bundle_price NUMERIC(10,2) NOT NULL DEFAULT 0,
        box_size TEXT NOT NULL DEFAULT 'large',
        notes TEXT,
        created_by INTEGER,
        created_by_name TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS bundle_items (
        id SERIAL PRIMARY KEY,
        bundle_id INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
        recipe_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle ON bundle_items (bundle_id)`);
    // Bundle lines can also be manual (misc gifts) or seeded from an ingredient,
    // so recipe_id is optional and manual lines carry their own label/cost/rrp.
    await db.execute(sql`ALTER TABLE bundle_items ALTER COLUMN recipe_id DROP NOT NULL`);
    await db.execute(sql`ALTER TABLE bundle_items ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'recipe'`);
    await db.execute(sql`ALTER TABLE bundle_items ADD COLUMN IF NOT EXISTS label TEXT`);
    await db.execute(sql`ALTER TABLE bundle_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(10,2)`);
    await db.execute(sql`ALTER TABLE bundle_items ADD COLUMN IF NOT EXISTS unit_rrp NUMERIC(10,2)`);
    // A free giveaway line still counts its RRP (perceived value) and cost (we
    // bear it), but contributes nothing to what the customer pays.
    await db.execute(sql`ALTER TABLE bundle_items ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT false`);
    await db.execute(sql`
      ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_current_special BOOLEAN NOT NULL DEFAULT FALSE
    `);
    // "Mark building finished" — authoritative end of the production window
    // for the batches-per-hour KPI and the lunch-deduction decision.
    await db.execute(sql`ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS building_finished_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS building_finished_by_user_id INTEGER`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS oven_events (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
        recipe_id INTEGER,
        recipe_name TEXT,
        ingredient_id INTEGER,
        ingredient_name TEXT,
        tray_index INTEGER NOT NULL,
        oven_in_at TIMESTAMP NOT NULL DEFAULT NOW(),
        oven_out_at TIMESTAMP,
        user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        user_name TEXT
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS recipes_one_current_special
      ON recipes (is_current_special)
      WHERE is_current_special = TRUE
    `);
    await db.execute(sql`
      ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS extra_packs_built INTEGER NOT NULL DEFAULT 0
    `);
    // Per-SOP manual override for the print-to-PDF layout (steps per page,
    // 1-6). NULL = auto-detect a balanced number per page.
    await db.execute(sql`
      ALTER TABLE standards_sops ADD COLUMN IF NOT EXISTS steps_per_page INTEGER
    `);
    // Curated "system updates" changelog shown on the morning-meeting slide.
    // body holds the bullet lines (one per line).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS system_updates (
        id serial PRIMARY KEY,
        title text,
        body text NOT NULL,
        published boolean NOT NULL DEFAULT true,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    // Each update carries an optional screenshot of the feature it describes.
    // The morning-meeting slide leads with the picture — a wall of bullets was
    // being skipped over, and the team recognises a screen far faster than a
    // sentence about it. Stored inline as bytea, same as every other image in
    // this app (gratitude photo, improvement attachments).
    await db.execute(sql`
      ALTER TABLE system_updates ADD COLUMN IF NOT EXISTS image BYTEA
    `);
    await db.execute(sql`
      ALTER TABLE system_updates ADD COLUMN IF NOT EXISTS image_mime TEXT
    `);
    // Improvements consolidation: "struggles" are now just improvements.
    // Idempotent — a no-op once no struggle rows remain.
    await db.execute(sql`
      UPDATE improvement_submissions SET type = 'improvement' WHERE type = 'struggle'
    `);
    // Photos & videos attached to an improvement (multiple per improvement),
    // stored as bytea like SOP step media so it works without object storage.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS improvement_attachments (
        id serial PRIMARY KEY,
        improvement_id integer NOT NULL REFERENCES improvement_submissions(id) ON DELETE CASCADE,
        kind text NOT NULL,
        mime text NOT NULL,
        data bytea NOT NULL,
        file_name text,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS improvement_attachments_improvement_idx ON improvement_attachments (improvement_id)
    `);
    await db.execute(sql`
      ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS short_count INTEGER NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS wonly_total INTEGER NOT NULL DEFAULT 0
    `);
    // Best-effort backfill so today's plans don't all show "0 wonkies recorded"
    // straight after the migration. For items where wrapping has been marked
    // complete, the auto-freeze has already moved wonkies into freezer_qty so
    // we approximate wonly_total = wonly_count + freezer_qty. Pre-completion
    // items just take wonly_count. May slightly over-count for items where
    // freezer_qty came from direct freezer transfers rather than wonkies, but
    // that's a minor display artefact compared to losing the count entirely.
    await db.execute(sql`
      UPDATE production_plan_items
      SET wonly_total = CASE
        WHEN wrapping_complete THEN wonly_count + freezer_qty
        ELSE wonly_count
      END
      WHERE wonly_total = 0
        AND (wonly_count > 0 OR (wrapping_complete AND freezer_qty > 0))
    `);
    await db.execute(sql`
      ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS is_topping BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE recipe_sub_recipes ADD COLUMN IF NOT EXISTS is_topping BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS assembly_order INTEGER
    `);
    await db.execute(sql`
      ALTER TABLE recipe_sub_recipes ADD COLUMN IF NOT EXISTS assembly_order INTEGER
    `);
    await db.execute(sql`
      ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS mixing_overage NUMERIC(10,4) NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE recipe_sub_recipes ADD COLUMN IF NOT EXISTS mixing_overage NUMERIC(10,4) NOT NULL DEFAULT 0
    `);
    // show_in_prep: referenced by the recipe edit dialog + backend
    // route since commit 050896b but previously missing from BOTH
    // the drizzle schema AND the startup migration chain. PR #7
    // landed the drizzle side without this DDL and crashed the live
    // site because Railway's Postgres didn't have the column. This
    // migration creates it idempotently; the drizzle alignment is
    // in lib/db/src/schema/recipes.ts in the same commit.
    await db.execute(sql`
      ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS show_in_prep BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE recipe_sub_recipes ADD COLUMN IF NOT EXISTS show_in_prep BOOLEAN NOT NULL DEFAULT FALSE
    `);
    // marinade_add_at_cooking: a marinade item held back from prep day and
    // added at the mixing/cooking station on production day instead (e.g.
    // the Philly beef stock, which must NOT go into the trays the day
    // before). Drizzle alignment in lib/db/src/schema/recipes.ts lands in
    // the same commit — see the show_in_prep note above for why.
    await db.execute(sql`
      ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS marinade_add_at_cooking BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE recipe_sub_recipes ADD COLUMN IF NOT EXISTS marinade_add_at_cooking BOOLEAN NOT NULL DEFAULT FALSE
    `);
    // Per-recipe build-time target in seconds, nullable. Drives the
    // countdown timer inside the BATCH BUILT button on the building
    // station. Null = fall back to building_timer_default_seconds app
    // setting (default 480s = 8 minutes).
    await db.execute(sql`
      ALTER TABLE recipes ADD COLUMN IF NOT EXISTS target_build_seconds INTEGER
    `);
    // Grams knocked off the filling weight the building station displays, per
    // batch. Display only — nothing else reads it, so prep quantities, costing
    // and the printed plan keep using the recipe's real filling weight.
    await db.execute(sql`
      ALTER TABLE recipes ADD COLUMN IF NOT EXISTS builder_filling_deduction_grams INTEGER NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS surplus_percent NUMERIC(5,2) NOT NULL DEFAULT 10
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS surplus_mode TEXT NOT NULL DEFAULT 'percent'
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS surplus_absolute_qty NUMERIC(12,4)
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS requires_use_by_date BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS stock_in_packs BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE purchase_order_lines ALTER COLUMN ingredient_id DROP NOT NULL
    `);
    await db.execute(sql`
      ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS description TEXT
    `);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS _migrations_done (key TEXT PRIMARY KEY, done_at TIMESTAMP DEFAULT NOW())`);
    {
      const result = await db.execute<{ cnt: number }>(sql`
        INSERT INTO _migrations_done (key)
        SELECT 'requires_use_by_date_seed_v1'
        WHERE NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'requires_use_by_date_seed_v1')
        RETURNING 1 AS cnt
      `);
      if ((result.rowCount ?? 0) > 0) {
        await db.execute(sql`UPDATE ingredients SET requires_use_by_date = TRUE WHERE category = 'raw_meat'`);
        await db.execute(sql`UPDATE ingredients SET shelf_life_days = 5 WHERE category = 'vegetable' AND shelf_life_days IS NULL`);
        console.log("[use-by seed] Seeded raw_meat requires_use_by_date and vegetable shelf_life_days");
      }
    }
    await db.execute(sql`
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS order_frequency TEXT NOT NULL DEFAULT 'daily'
    `);
    await db.execute(sql`
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS order_days TEXT
    `);
    await db.execute(sql`
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS lead_time_days INTEGER NOT NULL DEFAULT 1
    `);
    await db.execute(sql`
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cutoff_time TEXT NOT NULL DEFAULT '17:00'
    `);
    await db.execute(sql`
      ALTER TABLE category_defaults ADD COLUMN IF NOT EXISTS default_pack_size INTEGER NOT NULL DEFAULT 1
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS storage_locations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        zone TEXT NOT NULL DEFAULT 'fridge',
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS storage_racks (
        id SERIAL PRIMARY KEY,
        location_id INTEGER NOT NULL REFERENCES storage_locations(id) ON DELETE CASCADE,
        label TEXT NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ingredient_storage_locations (
        id SERIAL PRIMARY KEY,
        ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
        location_id INTEGER NOT NULL REFERENCES storage_locations(id) ON DELETE CASCADE,
        rack_label TEXT,
        shelf_label TEXT
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS stock_transfers (
        id SERIAL PRIMARY KEY,
        ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
        from_location TEXT NOT NULL,
        to_location TEXT NOT NULL,
        quantity NUMERIC(10,4) NOT NULL,
        unit TEXT NOT NULL,
        transferred_at TIMESTAMP NOT NULL DEFAULT NOW(),
        user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        notes TEXT
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id SERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        plan_id INTEGER REFERENCES production_plans(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        placed_at TIMESTAMP,
        expected_delivery_date DATE,
        notes TEXT,
        placed_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS purchase_order_lines (
        id SERIAL PRIMARY KEY,
        purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
        quantity_required NUMERIC(10,4) NOT NULL DEFAULT 0,
        quantity_ordered NUMERIC(10,4) NOT NULL DEFAULT 0,
        quantity_received NUMERIC(10,4) NOT NULL DEFAULT 0,
        unit TEXT NOT NULL,
        unit_price NUMERIC(10,4),
        checked_off BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS delivery_records (
        id SERIAL PRIMARY KEY,
        purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        received_at TIMESTAMP NOT NULL DEFAULT NOW(),
        received_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        chilled_temp_c NUMERIC(5,1),
        frozen_temp_c NUMERIC(5,1),
        invoice_filed BOOLEAN NOT NULL DEFAULT FALSE,
        all_put_away BOOLEAN NOT NULL DEFAULT FALSE,
        kanbans_replaced BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS delivery_check_configs (
        id SERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        is_required BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS delivery_check_results (
        id SERIAL PRIMARY KEY,
        delivery_record_id INTEGER NOT NULL REFERENCES delivery_records(id) ON DELETE CASCADE,
        check_config_id INTEGER NOT NULL REFERENCES delivery_check_configs(id) ON DELETE CASCADE,
        passed BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kanban_items (
        id SERIAL PRIMARY KEY,
        ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'active',
        pulled_at TIMESTAMP,
        pulled_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        order_day_target DATE,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS dpt_ingredient_requirements (
        id SERIAL PRIMARY KEY,
        ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
        daily_qty_raw NUMERIC(10,4) NOT NULL DEFAULT 0,
        daily_qty_cooked NUMERIC(10,4) NOT NULL DEFAULT 0,
        unit TEXT NOT NULL,
        calculated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS stock_items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        unit TEXT NOT NULL,
        pack_weight NUMERIC(10,4) NOT NULL DEFAULT 0,
        cost_per_pack NUMERIC(10,4) NOT NULL DEFAULT 0,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        secondary_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        supplier_part_number TEXT,
        ordering_url TEXT,
        stock_check_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        stock_check_frequency TEXT NOT NULL DEFAULT 'daily',
        stock_check_day TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      ALTER TABLE stock_entries ADD COLUMN IF NOT EXISTS stock_item_id INTEGER REFERENCES stock_items(id) ON DELETE SET NULL
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS stock_item_categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      INSERT INTO stock_item_categories (name) VALUES ('Packaging'), ('Cleaning Materials'), ('Chemicals')
      ON CONFLICT (name) DO NOTHING
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS kanban_enabled BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS kanban_quantity NUMERIC(10,4) NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS kanban_unit TEXT NOT NULL DEFAULT 'weight'
    `);
    await db.execute(sql`
      ALTER TABLE stock_entries ADD COLUMN IF NOT EXISTS use_by_date DATE
    `);
    await db.execute(sql`
      ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS use_by_date DATE
    `);
    await db.execute(sql`
      ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS goods_in_checked BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE sub_recipes ADD COLUMN IF NOT EXISTS is_base BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      DELETE FROM prep_completions WHERE recipe_id IS NULL
    `);
    await db.execute(sql`
      ALTER TABLE prep_completions ALTER COLUMN recipe_id SET NOT NULL
    `);
    await db.execute(sql`
      DROP INDEX IF EXISTS uq_prep_completion_v2
    `);
    // NB: the previous CREATE of uq_prep_completion_v3 here was removed in
    // May 2026. v3's key (plan, ingredient, recipe, tin) doesn't include
    // sub_recipe_id, which the origin-tagging schema (a9fa76c) legitimately
    // varies — so reruns of this migration on systems that had v3 dropped
    // by the later block (~700 lines down) hit "key is duplicated" when
    // trying to recreate it, aborting startup before the new partial
    // indexes get installed. The two new partial indexes installed below
    // (uq_prep_completion_ing + uq_prep_completion_sub) supersede v3 and
    // enforce uniqueness correctly. The DROP at line ~700 cleans up v3
    // when migrating up from a pre-a9fa76c snapshot.
    // PIN login & avatar support (Task #36)
    await db.execute(sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS pin_hash TEXT`);
    await db.execute(sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS pin_attempts INTEGER NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMP`);
    await db.execute(sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
    // Avatars now live in Postgres too (same rationale as SOP images — no
    // object storage dependency). avatar_url remains the canonical pointer
    // the frontend uses for <img>; we just repoint it at a bytes endpoint.
    await db.execute(sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_mime TEXT`);
    await db.execute(sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_data BYTEA`);
    // Clear stale /objects/avatars/* URLs from the old GCS attempt (none of
    // those uploads succeeded, so the pointers all 404). Fresh uploads
    // overwrite with the new /api/auth/avatar/:id path.
    await db.execute(sql`UPDATE app_users SET avatar_url = NULL WHERE avatar_url LIKE '/objects/%' AND avatar_data IS NULL`);
    // Plan Day integration — employee record mapping for attendance reports
    await db.execute(sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS planday_employee_id INTEGER`);
    // Shopify inventory sync — recipe→variant mapping (Task #37)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recipe_shopify_mappings (
        id SERIAL PRIMARY KEY,
        recipe_id INTEGER NOT NULL UNIQUE REFERENCES recipes(id) ON DELETE CASCADE,
        shopify_variant_id TEXT NOT NULL,
        shopify_product_title TEXT,
        shopify_variant_title TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`ALTER TABLE recipe_shopify_mappings ADD COLUMN IF NOT EXISTS wonky_variant_id TEXT`);
    await db.execute(sql`ALTER TABLE recipe_shopify_mappings ADD COLUMN IF NOT EXISTS wonky_product_title TEXT`);
    await db.execute(sql`ALTER TABLE recipe_shopify_mappings ADD COLUMN IF NOT EXISTS wonky_variant_title TEXT`);
    // Factory-number accounting loop: idempotency table for the
    // Shopify fulfilment decrement path (both the immediate Confirm &
    // Complete call and the 5-minute safety-net poller dedupe
    // through this primary key).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS shopify_fulfilment_tracking (
        shopify_order_id BIGINT PRIMARY KEY,
        fulfilled_at TIMESTAMP NOT NULL,
        processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        source TEXT NOT NULL
      )
    `);
    // Founder custom tag panels (added for custom panel feature)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS founder_custom_panels (
        id SERIAL PRIMARY KEY,
        tag TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Improvements (Kaizen) and Andon issue tracking
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE improvement_approval_tier AS ENUM ('minor', 'medium', 'major');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE improvement_progress_status AS ENUM ('submitted_for_review', 'approved', 'testing', 'complete');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await db.execute(sql`
      DO $$ BEGIN
        ALTER TYPE improvement_progress_status ADD VALUE IF NOT EXISTS 'rejected';
      EXCEPTION WHEN others THEN NULL;
      END $$
    `);
    await db.execute(sql`
      DO $$ BEGIN
        ALTER TYPE improvement_progress_status ADD VALUE IF NOT EXISTS 'acknowledged';
      EXCEPTION WHEN others THEN NULL;
      END $$
    `);
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE andon_severity AS ENUM ('yellow', 'red', 'green');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await db.execute(sql`ALTER TYPE andon_severity ADD VALUE IF NOT EXISTS 'green'`);
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE andon_category AS ENUM ('equipment', 'safety', 'production', 'product', 'other');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS improvement_submissions (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        station TEXT NOT NULL,
        submitted_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        submitted_by_name TEXT,
        approval_tier improvement_approval_tier,
        progress_status improvement_progress_status NOT NULL DEFAULT 'submitted_for_review',
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS andon_issues (
        id SERIAL PRIMARY KEY,
        category andon_category NOT NULL,
        severity andon_severity NOT NULL,
        description TEXT,
        station TEXT NOT NULL,
        reported_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        reported_by_name TEXT,
        acknowledged_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        acknowledged_by_name TEXT,
        acknowledged_at TIMESTAMP,
        resolved_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        resolved_by_name TEXT,
        resolved_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS energy_kj NUMERIC(10,2)`);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS energy_kcal NUMERIC(10,2)`);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS fat NUMERIC(10,2)`);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS saturates NUMERIC(10,2)`);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS carbohydrate NUMERIC(10,2)`);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS sugars NUMERIC(10,2)`);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS protein NUMERIC(10,2)`);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS fibre NUMERIC(10,2)`);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS salt NUMERIC(10,2)`);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS label_declaration TEXT`);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS allergens JSONB DEFAULT '[]'`);
    await db.execute(sql`ALTER TABLE sub_recipes ADD COLUMN IF NOT EXISTS label_declaration TEXT`);
    await db.execute(sql`ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS quid BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE recipe_sub_recipes ADD COLUMN IF NOT EXISTS quid BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS prep_weight_mode TEXT NOT NULL DEFAULT 'raw'`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS _migrations_done (key TEXT PRIMARY KEY, done_at TIMESTAMP DEFAULT NOW())`);
    await db.execute(sql`
      INSERT INTO _migrations_done (key)
      SELECT 'prep_weight_mode_backfill'
      WHERE NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'prep_weight_mode_backfill')
    `);
    {
      const result = await db.execute<{ cnt: number }>(sql`SELECT count(*)::int as cnt FROM _migrations_done WHERE key = 'prep_weight_mode_backfill' AND done_at > NOW() - INTERVAL '5 seconds'`);
      if (Number(result.rows[0]?.cnt) > 0) {
        await db.execute(sql`UPDATE ingredients SET prep_weight_mode = 'processed' WHERE category IN ('vegetable', 'herb') AND prep_weight_mode = 'raw'`);
      }
    }
    await db.execute(sql`ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'improvement'`);
    // Improvements: assignee (defaults to the submitter) + collapse the old
    // seven-step workflow to two statuses: Submitted and Complete.
    await db.execute(sql`ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES app_users(id) ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS assigned_to_name TEXT`);
    await db.execute(sql`
      INSERT INTO _migrations_done (key)
      SELECT 'improvements_assignee_backfill'
      WHERE NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'improvements_assignee_backfill')
    `);
    {
      const result = await db.execute<{ cnt: number }>(sql`SELECT count(*)::int as cnt FROM _migrations_done WHERE key = 'improvements_assignee_backfill' AND done_at > NOW() - INTERVAL '5 seconds'`);
      if (Number(result.rows[0]?.cnt) > 0) {
        await db.execute(sql`
          UPDATE improvement_submissions
          SET assigned_to = submitted_by, assigned_to_name = submitted_by_name
          WHERE assigned_to IS NULL AND assigned_to_name IS NULL
        `);
      }
    }
    await db.execute(sql`
      UPDATE improvement_submissions
      SET progress_status = 'submitted_for_review'
      WHERE progress_status NOT IN ('submitted_for_review', 'complete')
    `);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS qr_code_url TEXT`);
    await db.execute(sql`ALTER TABLE kanban_items ALTER COLUMN ingredient_id DROP NOT NULL`);
    await db.execute(sql`ALTER TABLE kanban_items ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'ingredient'`);
    await db.execute(sql`ALTER TABLE kanban_items ADD COLUMN IF NOT EXISTS recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE`);
    await db.execute(sql`ALTER TABLE kanban_items ADD COLUMN IF NOT EXISTS sub_recipe_id INTEGER REFERENCES sub_recipes(id) ON DELETE CASCADE`);
    await db.execute(sql`ALTER TABLE kanban_items ADD COLUMN IF NOT EXISTS qr_code_url TEXT`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS kanban_items_recipe_unique ON kanban_items (recipe_id) WHERE source_type = 'recipe' AND recipe_id IS NOT NULL`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS kanban_items_sub_recipe_unique ON kanban_items (sub_recipe_id) WHERE source_type = 'sub_recipe' AND sub_recipe_id IS NOT NULL`);
    await db.execute(sql`DO $$ BEGIN ALTER TABLE kanban_items ADD CONSTRAINT kanban_items_source_type_check CHECK (source_type IN ('ingredient', 'recipe', 'sub_recipe')); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    // Standards & SOPs — multi-step SOPs with optional per-step image.
    // Images live as BYTEA on sop_steps so everything works local + prod
    // with no external deps.
    //
    // NOTE: an earlier version of this block ran `DROP TABLE IF EXISTS
    // standards_sops CASCADE` here, intended as a one-shot legacy schema
    // wipe. The drop was never gated, so it fired on every API startup —
    // erasing every SOP each time the container restarted. The legacy
    // wipe has long since completed on prod; the table now only needs the
    // idempotent CREATE + ALTERs below.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS standards_sops (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        stations TEXT[] NOT NULL DEFAULT '{}',
        author_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS standards_sops_updated_at_idx ON standards_sops (updated_at DESC)`);
    // Free-form tags column alongside station tags, so SOPs can be
    // categorised by things like "rotation", "safety", "changeover"
    // without polluting the workstation list.
    await db.execute(sql`ALTER TABLE standards_sops ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sop_steps (
        id SERIAL PRIMARY KEY,
        sop_id INTEGER NOT NULL REFERENCES standards_sops(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        description TEXT NOT NULL DEFAULT '',
        image_mime TEXT,
        image_data BYTEA,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS sop_steps_sop_position_idx ON sop_steps (sop_id, position)`);
    // Per-step video media. Independent of image_* so a step can carry both
    // a still and a clip if useful; in practice it's usually one or the other.
    await db.execute(sql`ALTER TABLE sop_steps ADD COLUMN IF NOT EXISTS video_mime TEXT`);
    await db.execute(sql`ALTER TABLE sop_steps ADD COLUMN IF NOT EXISTS video_data BYTEA`);
    // Retrofit the sop_steps → standards_sops FK. The CREATE TABLE above
    // declares ON DELETE CASCADE, but tables that pre-date it were created
    // without any FK (CREATE TABLE IF NOT EXISTS never retrofits
    // constraints), so deleting an SOP stranded its steps — BYTEA
    // image/video blobs included — as invisible orphans. Purge existing
    // orphans first or ADD CONSTRAINT itself would fail validation.
    // See lib/db/migrations/0028_sop_steps_fk_cascade.sql.
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'sop_steps'::regclass AND contype = 'f'
        ) THEN
          DELETE FROM sop_steps s WHERE NOT EXISTS (
            SELECT 1 FROM standards_sops ss WHERE ss.id = s.sop_id
          );
          ALTER TABLE sop_steps
            ADD CONSTRAINT sop_steps_sop_id_fkey
            FOREIGN KEY (sop_id) REFERENCES standards_sops(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    // Stable def_key identity for built-in storage locations — see
    // lib/db/migrations/0029_storage_location_def_key.sql. Replaces the
    // fragile match-by-name so renaming a built-in fridge no longer makes
    // it vanish from Stock Control / temp checks or strand its stock.
    // Must run BEFORE seedStorageLocations — the seed writes def_key.
    await db.execute(sql`ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS def_key TEXT`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS storage_locations_def_key_uq
        ON storage_locations (def_key) WHERE def_key IS NOT NULL
    `);
    for (const def of LOCATION_DEFS) {
      await db.execute(sql`
        UPDATE storage_locations SET def_key = ${def.key}
        WHERE is_system AND def_key IS NULL AND lower(name) = ${def.label.toLowerCase()}
          AND NOT EXISTS (SELECT 1 FROM storage_locations WHERE def_key = ${def.key})
      `);
    }
    // System rows whose names no longer match any def (renamed at some
    // point) were invisible in both UIs — normalise them to user rows so
    // they reappear with their current names.
    await db.execute(sql`UPDATE storage_locations SET is_system = FALSE WHERE is_system AND def_key IS NULL`);

    await seedStorageLocations();

    const kanbanBackfillResult = await db.execute(sql`
      INSERT INTO kanban_items (ingredient_id, supplier_id, status, source_type)
      SELECT i.id, i.supplier_id, 'active', 'ingredient'
      FROM ingredients i
      WHERE i.kanban_enabled = true
        AND NOT EXISTS (
          SELECT 1 FROM kanban_items k
          WHERE k.ingredient_id = i.id AND k.source_type = 'ingredient'
        )
    `);
    const kanbanBackfillCount = kanbanBackfillResult.rowCount ?? 0;
    if (kanbanBackfillCount > 0) {
      console.log(`[kanban backfill] Created ${kanbanBackfillCount} kanban item(s) for kanban-enabled ingredients`);
    }

    await db.execute(sql`
      ALTER TABLE prep_completions ADD COLUMN IF NOT EXISTS sub_recipe_id INTEGER REFERENCES sub_recipes(id)
    `);
    await db.execute(sql`
      ALTER TABLE prep_completions ALTER COLUMN ingredient_id DROP NOT NULL
    `);
    await db.execute(sql`
      DROP INDEX IF EXISTS uq_prep_completion_v3
    `);
    // Two partial unique indexes:
    //  - uq_prep_completion_ing:  ingredient completions, optionally tagged
    //                              with the originating sub-recipe (sub_recipe_id
    //                              column is reused as the origin marker). The
    //                              COALESCE-with-0 makes NULL collapse to a
    //                              single bucket so legacy "no origin" rows
    //                              still dedupe correctly while origin-tagged
    //                              rows (e.g. cheddar from Breadcrumb Topping
    //                              vs from Macaroni Cheese sauce, both under
    //                              the same parent recipe) live in their own
    //                              buckets and can be ticked independently.
    //  - uq_prep_completion_sub:  whole-sub-recipe completions where the
    //                              operator ticks off "macaroni cheese sauce
    //                              ready" as a unit rather than ingredient-by-
    //                              ingredient. Unchanged from before.
    await db.execute(sql`
      DROP INDEX IF EXISTS uq_prep_completion_ing
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_prep_completion_ing
      ON prep_completions (plan_id, ingredient_id, COALESCE(sub_recipe_id, 0), recipe_id, tin_number)
      WHERE ingredient_id IS NOT NULL
    `);
    // Drop-before-recreate: an earlier version of this migration created
    // uq_prep_completion_sub with predicate `WHERE sub_recipe_id IS NOT NULL`
    // (no ingredient_id clause). CREATE UNIQUE INDEX IF NOT EXISTS treats a
    // matching name as "already there" regardless of the predicate, so the
    // tightened definition below silently failed to apply on any live system
    // that ran the earlier version. Symptom: ticking a second expanded
    // ingredient under the same (sub_recipe, parent recipe, tin) — e.g. the
    // pasta after the cheddar inside Big Nanny's Macaroni Cheese sub-recipe
    // on Main Prep — 409s because the old (looser) index treats both rows
    // as duplicates even though they're different ingredients.
    await db.execute(sql`
      DROP INDEX IF EXISTS uq_prep_completion_sub
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_prep_completion_sub
      ON prep_completions (plan_id, sub_recipe_id, recipe_id, tin_number)
      WHERE sub_recipe_id IS NOT NULL AND ingredient_id IS NULL
    `);

    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS is_bottle BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS bottle_size NUMERIC(10,4)
    `);
    // Prep-only display override for count-style ingredients (e.g. pigs &
    // blankets shown as individual sausages rather than kg). See the
    // column comment in lib/db/src/schema/ingredients.ts.
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS prep_count_per_portion INTEGER
    `);
    // Pasta-type flag — drives the synthetic pasta-cooking prep rows.
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS is_pasta BOOLEAN NOT NULL DEFAULT FALSE
    `);
    // True when per-100g nutritionals were filled by the name-only AI
    // estimate flow. Surfaces in the form as a ✨ chip so operators know
    // to verify before relying on the numbers for printed packaging.
    await db.execute(sql`
      ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS nutritionals_ai_estimated BOOLEAN NOT NULL DEFAULT FALSE
    `);
    // Hide a sub-recipe component from the prep-station expansion while
    // keeping it in the data for ratio/cost maths.
    await db.execute(sql`
      ALTER TABLE sub_recipe_ingredients ADD COLUMN IF NOT EXISTS hide_from_prep BOOLEAN NOT NULL DEFAULT FALSE
    `);
    // Seed the pasta-cooking admin settings (water L per kg, salt g per kg).
    // Defaults are sensible starting points — admins adjust in Settings.
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('pasta_cooking_water_l_per_kg', '6', NOW())
      ON CONFLICT (key) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('pasta_cooking_salt_g_per_kg', '60', NOW())
      ON CONFLICT (key) DO NOTHING
    `);

    // P&L estimation dashboard tables
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pnl_settings (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      INSERT INTO pnl_settings (key, value) VALUES
        ('small_box_cost', '2.50'),
        ('large_box_cost', '3.50')
      ON CONFLICT (key) DO NOTHING
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pnl_overheads (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        monthly_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Note: references app_users(id) — the canonical user table name.
    // Historically this was written as users(id) which matches nothing
    // and aborted the whole startup-migration run, so shopify_fulfilment_tracking
    // and every subsequent DDL silently never ran.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS improvement_comments (
        id SERIAL PRIMARY KEY,
        improvement_id INTEGER NOT NULL REFERENCES improvement_submissions(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        user_name TEXT,
        comment TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS andon_comments (
        id SERIAL PRIMARY KEY,
        andon_id INTEGER NOT NULL REFERENCES andon_issues(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        user_name TEXT,
        comment TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`ALTER TABLE improvement_submissions ADD COLUMN IF NOT EXISTS report_context TEXT`);
    await db.execute(sql`ALTER TABLE andon_issues ADD COLUMN IF NOT EXISTS report_context TEXT`);

    await db.execute(sql`ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS prep_date DATE`);
    await db.execute(sql`ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS dough_date DATE`);

    // Seed the non-dispatch dates list (bank holidays / shutdowns) on
    // first run so the calc endpoints handle the upcoming May Day Monday
    // correctly without operator intervention. ON CONFLICT DO NOTHING
    // keeps any user-edited list intact across restarts.
    await db.execute(sql`
      INSERT INTO app_settings (key, value)
      VALUES (
        'non_dispatch_dates',
        '["2026-05-04","2026-05-25","2026-08-31","2026-12-25","2026-12-28","2027-01-01"]'
      )
      ON CONFLICT (key) DO NOTHING
    `);

    // Multi-variant recipe mapping: remove unique-per-recipe constraint,
    // add unique-per-variant instead (many variants can map to one recipe)
    await db.execute(sql`
      ALTER TABLE recipe_shopify_mappings DROP CONSTRAINT IF EXISTS recipe_shopify_mappings_recipe_id_key
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS recipe_shopify_mappings_variant_unique ON recipe_shopify_mappings (shopify_variant_id)
    `);

    // 8-pack bag support
    await db.execute(sql`ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS eight_pack_bag_count INTEGER NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS fridge_eight_pack_qty INTEGER NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE stock_entries ADD COLUMN IF NOT EXISTS pack_size INTEGER NOT NULL DEFAULT 2`);
    await db.execute(sql`ALTER TABLE recipe_shopify_mappings ADD COLUMN IF NOT EXISTS eight_pack_variant_id TEXT`);
    await db.execute(sql`ALTER TABLE recipe_shopify_mappings ADD COLUMN IF NOT EXISTS eight_pack_product_title TEXT`);
    await db.execute(sql`ALTER TABLE recipe_shopify_mappings ADD COLUMN IF NOT EXISTS eight_pack_variant_title TEXT`);

    // Shopify SKU cache. Used to sort the packing checklists (opening
    // batch numbers, closing batch numbers, batch entry rows) in SKU
    // order so the kitchen scanner UI matches Easy Scan's ordering.
    // Populated from Shopify on first run + when a mapping is saved.
    await db.execute(sql`ALTER TABLE recipe_shopify_mappings ADD COLUMN IF NOT EXISTS shopify_sku TEXT`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS recipe_shopify_mappings_sku_idx ON recipe_shopify_mappings (shopify_sku)`);

    // Deduplicate station_breaks: old code created one row per station type per break.
    // Keep only the lowest id per (plan_id, user_id, break_type, started_at) group.
    await db.execute(sql`
      DELETE FROM station_breaks
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM station_breaks
        GROUP BY plan_id, user_id, break_type, started_at
      )
    `);

    // Move any ingredient stock entries out of production_fridge (finished product only)
    await db.execute(sql`
      UPDATE stock_entries
      SET location = 'prep_fridge'
      WHERE item_type = 'ingredient' AND location = 'production_fridge'
    `);
    // Same for production_freezer
    await db.execute(sql`
      UPDATE stock_entries
      SET location = 'prep_fridge'
      WHERE item_type = 'ingredient' AND location = 'production_freezer'
    `);

    // Batch-level fridge stock tracking
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS fridge_stock_batches (
        id SERIAL PRIMARY KEY,
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        batch_number INTEGER NOT NULL,
        pack_size INTEGER NOT NULL DEFAULT 2,
        quantity INTEGER NOT NULL DEFAULT 0,
        use_by_date DATE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_fridge_stock_batches_recipe_batch_packsize
        ON fridge_stock_batches (recipe_id, batch_number, pack_size)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_fridge_stock_batches_recipe_usebydate
        ON fridge_stock_batches (recipe_id, pack_size, use_by_date ASC)
    `);

    // Tin count overrides for prep stations
    await db.execute(sql`ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS mixing_tin_override INTEGER`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS packing_batch_records (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        batch_number INTEGER NOT NULL,
        user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(plan_id, recipe_id)
      )
    `);
    // Split single batch_number into first/last for opening + closing
    // checks. Old `batch_number`/`user_id`/`recorded_at` columns kept for
    // safety until everything has migrated; the app now reads the
    // first_*/last_* columns exclusively.
    await db.execute(sql`ALTER TABLE packing_batch_records ADD COLUMN IF NOT EXISTS first_batch_number INTEGER`);
    await db.execute(sql`ALTER TABLE packing_batch_records ADD COLUMN IF NOT EXISTS last_batch_number INTEGER`);
    await db.execute(sql`ALTER TABLE packing_batch_records ADD COLUMN IF NOT EXISTS first_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE packing_batch_records ADD COLUMN IF NOT EXISTS last_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE packing_batch_records ADD COLUMN IF NOT EXISTS first_recorded_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE packing_batch_records ADD COLUMN IF NOT EXISTS last_recorded_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE packing_batch_records ALTER COLUMN batch_number DROP NOT NULL`);
    // Backfill from the legacy columns where the new ones are still empty.
    await db.execute(sql`
      UPDATE packing_batch_records
      SET first_batch_number = batch_number,
          first_user_id = user_id,
          first_recorded_at = recorded_at
      WHERE first_batch_number IS NULL AND batch_number IS NOT NULL
    `);

    // Per-fridge/freezer opening + closing temperature recording, driven
    // by the storage_locations table (system + admin-added locations).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS location_temperature_records (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
        storage_location_id INTEGER NOT NULL REFERENCES storage_locations(id) ON DELETE CASCADE,
        opening_temperature_c NUMERIC(5,1),
        closing_temperature_c NUMERIC(5,1),
        opening_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        closing_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        opening_recorded_at TIMESTAMP,
        closing_recorded_at TIMESTAMP,
        UNIQUE(plan_id, storage_location_id)
      )
    `);

    // Collections — goods leaving the unit, the mirror of a delivery.
    // See lib/db/migrations/0032_add_collections.sql. The weekly deliveries
    // view queries this on every render, so it must exist everywhere.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS collections (
        id SERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        collection_date DATE NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        reference TEXT,
        notes TEXT,
        driver_name TEXT,
        signature_blob BYTEA,
        signature_mime TEXT,
        photo_blob BYTEA,
        photo_mime TEXT,
        collected_at TIMESTAMP,
        collected_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        collected_by_name TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_collections_supplier_date ON collections (supplier_id, collection_date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_collections_date ON collections (collection_date)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS collection_lines (
        id SERIAL PRIMARY KEY,
        collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
        unit TEXT NOT NULL DEFAULT 'items',
        checked_off BOOLEAN NOT NULL DEFAULT FALSE,
        quantity_collected NUMERIC(10,2),
        notes TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_collection_lines_collection ON collection_lines (collection_id)`);

    // Case orders — see lib/db/migrations/0033_add_case_orders.sql. Order
    // matters: production_plan_items.case_order_id FKs case_orders, so the
    // tables come first.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS case_types (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS case_type_lines (
        id SERIAL PRIMARY KEY,
        case_type_id INTEGER NOT NULL REFERENCES case_types(id) ON DELETE CASCADE,
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE RESTRICT,
        bags_per_case INTEGER NOT NULL DEFAULT 1
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_case_type_lines_type ON case_type_lines (case_type_id)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS case_orders (
        id SERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        reference TEXT,
        target_collection_date DATE NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_case_orders_target ON case_orders (target_collection_date)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS case_order_lines (
        id SERIAL PRIMARY KEY,
        case_order_id INTEGER NOT NULL REFERENCES case_orders(id) ON DELETE CASCADE,
        case_type_id INTEGER NOT NULL REFERENCES case_types(id) ON DELETE RESTRICT,
        cases_ordered INTEGER NOT NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_case_order_lines_order ON case_order_lines (case_order_id)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS case_order_production (
        id SERIAL PRIMARY KEY,
        case_order_id INTEGER NOT NULL REFERENCES case_orders(id) ON DELETE CASCADE,
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE RESTRICT,
        plan_id INTEGER REFERENCES production_plans(id) ON DELETE SET NULL,
        production_date DATE NOT NULL,
        bags INTEGER NOT NULL,
        counted_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        counted_by_name TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_case_order_production_order ON case_order_production (case_order_id, recipe_id)`);
    await db.execute(sql`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS max_batches_per_day INTEGER`);
    await db.execute(sql`ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS freezer_eight_pack_bag_count INTEGER NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS freezer_eight_pack_qty INTEGER NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS case_order_id INTEGER REFERENCES case_orders(id) ON DELETE SET NULL`);
    await db.execute(sql`INSERT INTO app_settings (key, value, updated_at) VALUES ('capacity_batches_with_dough_prep', '110', NOW()) ON CONFLICT (key) DO NOTHING`);
    await db.execute(sql`INSERT INTO app_settings (key, value, updated_at) VALUES ('capacity_batches_without_dough_prep', '80', NOW()) ON CONFLICT (key) DO NOTHING`);
    await db.execute(sql`INSERT INTO app_settings (key, value, updated_at) VALUES ('capacity_dough_prep_position_name', 'Dough Prep', NOW()) ON CONFLICT (key) DO NOTHING`);

    // Re-key the fulfilment barcode cache from SKU to Shopify variant id —
    // see lib/db/migrations/0034_sku_barcodes_variant_key.sql. TCK SKUs are
    // shelf labels shared by many products, so the SKU-keyed cache attached
    // the wrong product's barcode/image to order lines (2026-07-30:
    // buttermilk vs korean strips, both SKU "1"). Guarded by _migrations_done
    // because the wipe must not repeat on every boot: the cache refills via
    // the manual "Sync from Shopify" button, and an unconditional DELETE
    // would silently blank the scanner between sync runs.
    await db.execute(sql`CREATE TABLE IF NOT EXISTS _migrations_done (key TEXT PRIMARY KEY, done_at TIMESTAMP DEFAULT NOW())`);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'sku_barcodes_variant_key_v1') THEN
          ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS variant_id TEXT;
          DELETE FROM sku_barcodes;
          ALTER TABLE sku_barcodes DROP CONSTRAINT IF EXISTS sku_barcodes_pkey;
          ALTER TABLE sku_barcodes ALTER COLUMN sku DROP NOT NULL;
          ALTER TABLE sku_barcodes ALTER COLUMN variant_id SET NOT NULL;
          ALTER TABLE sku_barcodes ADD PRIMARY KEY (variant_id);
          INSERT INTO _migrations_done (key) VALUES ('sku_barcodes_variant_key_v1');
        END IF;
      END $$;
    `);

    // Founder Focus — see lib/db/migrations/0035_founder_focus.sql. Tables
    // are additive; the pillar/goal seed (from Graeme's 2026-07-30 notebook)
    // runs once, guarded, so later UI edits are never re-seeded.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS founder_pillars (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        sort INTEGER NOT NULL DEFAULT 0,
        target_share_pct INTEGER,
        notes TEXT,
        archived_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS founder_goals (
        id SERIAL PRIMARY KEY,
        pillar_id INTEGER NOT NULL REFERENCES founder_pillars(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        detail TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        sort INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        done_at TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS founder_blocks (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        start_min INTEGER NOT NULL,
        end_min INTEGER NOT NULL,
        pillar_id INTEGER REFERENCES founder_pillars(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_founder_blocks_date ON founder_blocks (date)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS founder_block_templates (
        id SERIAL PRIMARY KEY,
        weekday INTEGER NOT NULL,
        start_min INTEGER NOT NULL,
        end_min INTEGER NOT NULL,
        pillar_id INTEGER REFERENCES founder_pillars(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        sort INTEGER NOT NULL DEFAULT 0
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS founder_parking_lot (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMP
      )
    `);
    await db.execute(sql`
      DO $$
      DECLARE
        claude_id INTEGER; sales_id INTEGER; team_id INTEGER; product_id INTEGER;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'founder_focus_seed_v1') THEN
          INSERT INTO founder_pillars (name, color, sort, notes) VALUES
            ('Claude & Systems', '#7cb342', 0, 'AI + app work — the leverage multiplier.')
            RETURNING id INTO claude_id;
          INSERT INTO founder_pillars (name, color, sort, notes) VALUES
            ('Sales', '#3b82f6', 1, 'Revenue-driving work only Graeme can do.')
            RETURNING id INTO sales_id;
          INSERT INTO founder_pillars (name, color, sort, notes) VALUES
            ('Team & Coaching', '#f59e0b', 2, 'No experienced manager in the team yet — this one is founder-only for now.')
            RETURNING id INTO team_id;
          INSERT INTO founder_pillars (name, color, sort, notes) VALUES
            ('Product', '#8b5cf6', 3, 'From the notebook with a question mark — flesh out or archive.')
            RETURNING id INTO product_id;
          INSERT INTO founder_goals (pillar_id, title, detail, sort) VALUES
            (claude_id, 'AI customer service agent', 'In progress — recently started, making progress.', 0),
            (claude_id, 'Website: subs, conversion rate, customer experience', 'E-commerce improvements on the Shopify site.', 1),
            (claude_id, 'Production planner', 'Ongoing app development.', 2),
            (sales_id, 'Online', NULL, 0),
            (sales_id, 'Wholesale', NULL, 1),
            (team_id, 'Buddy system', NULL, 0),
            (team_id, 'Outstanding performer', NULL, 1),
            (team_id, '30 mins a day one-on-one', 'Daily corrective-coaching slot.', 2),
            (team_id, 'Bottom 3 performers', 'Corrective coaching focus.', 3),
            (team_id, 'Culture', NULL, 4);
          INSERT INTO _migrations_done (key) VALUES ('founder_focus_seed_v1');
        END IF;
      END $$;
    `);

    // Founder Focus recurring items + default week — see
    // lib/db/migrations/0037_founder_recurring_and_week_template.sql.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS founder_recurring_items (
        id SERIAL PRIMARY KEY,
        pillar_id INTEGER NOT NULL REFERENCES founder_pillars(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        sort INTEGER NOT NULL DEFAULT 0,
        archived_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS founder_recurring_ticks (
        id SERIAL PRIMARY KEY,
        item_id INTEGER NOT NULL REFERENCES founder_recurring_items(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        ticked_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (item_id, date)
      )
    `);
    await db.execute(sql`
      DO $$
      DECLARE
        sales_id INTEGER; team_id INTEGER; claude_id INTEGER; product_id INTEGER;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'founder_focus_seed_v2') THEN
          -- Graeme consistently calls this pillar "sales and marketing".
          UPDATE founder_pillars SET name = 'Sales & Marketing' WHERE name = 'Sales';

          SELECT id INTO sales_id FROM founder_pillars WHERE name = 'Sales & Marketing' AND archived_at IS NULL LIMIT 1;
          SELECT id INTO team_id FROM founder_pillars WHERE name = 'Team & Coaching' AND archived_at IS NULL LIMIT 1;
          SELECT id INTO claude_id FROM founder_pillars WHERE name = 'Claude & Systems' AND archived_at IS NULL LIMIT 1;
          SELECT id INTO product_id FROM founder_pillars WHERE name = 'Product' AND archived_at IS NULL LIMIT 1;

          IF team_id IS NOT NULL THEN
            INSERT INTO founder_recurring_items (pillar_id, title, sort)
            VALUES (team_id, '30-min one-on-one coaching', 0);
          END IF;

          -- Default Mon-Fri week (weekday 1..5, 0=Sunday). Only when the
          -- template is still empty so hand-made rows are never clobbered.
          IF NOT EXISTS (SELECT 1 FROM founder_block_templates) THEN
            FOR wd IN 1..5 LOOP
              IF team_id IS NOT NULL THEN
                INSERT INTO founder_block_templates (weekday, start_min, end_min, pillar_id, title) VALUES (wd, 420, 480, team_id, 'Team & Coaching');
                INSERT INTO founder_block_templates (weekday, start_min, end_min, pillar_id, title) VALUES (wd, 840, 900, team_id, 'Team & Coaching');
              END IF;
              IF sales_id IS NOT NULL THEN
                INSERT INTO founder_block_templates (weekday, start_min, end_min, pillar_id, title) VALUES (wd, 480, 540, sales_id, 'Sales & Marketing');
              END IF;
              IF claude_id IS NOT NULL THEN
                INSERT INTO founder_block_templates (weekday, start_min, end_min, pillar_id, title) VALUES (wd, 540, 720, claude_id, 'Claude & Systems');
              END IF;
              IF product_id IS NOT NULL THEN
                INSERT INTO founder_block_templates (weekday, start_min, end_min, pillar_id, title) VALUES (wd, 720, 840, product_id, 'Product');
              END IF;
            END LOOP;
          END IF;

          INSERT INTO _migrations_done (key) VALUES ('founder_focus_seed_v2');
        END IF;
      END $$;
    `);

    // Founder Focus goal URLs + ritual recurrence — see
    // lib/db/migrations/0039_founder_goal_urls_and_recurrence.sql.
    await db.execute(sql`ALTER TABLE founder_goals ADD COLUMN IF NOT EXISTS url TEXT`);
    await db.execute(sql`ALTER TABLE founder_recurring_items ADD COLUMN IF NOT EXISTS url TEXT`);
    await db.execute(sql`ALTER TABLE founder_recurring_items ADD COLUMN IF NOT EXISTS schedule TEXT NOT NULL DEFAULT 'daily'`);
    await db.execute(sql`ALTER TABLE founder_recurring_items ADD COLUMN IF NOT EXISTS schedule_day INTEGER`);
    await db.execute(sql`ALTER TABLE founder_recurring_items ADD COLUMN IF NOT EXISTS anchor_date DATE`);

    // Founder objectives — see lib/db/migrations/0042_founder_objectives.sql.
    // Moonshot / Mission / Stepping Stones above the pillars on /founder/focus.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS founder_objectives (
        id SERIAL PRIMARY KEY,
        horizon TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        metric TEXT,
        target_date DATE,
        sort INTEGER NOT NULL DEFAULT 0,
        achieved_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Sales & Marketing assistant — see lib/db/migrations/0043_marketing_events.sql.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS marketing_events (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        offer TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('monthly_revenue_target', '120000', NOW())
      ON CONFLICT (key) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('marketing_email_cadence_days', '3', NOW())
      ON CONFLICT (key) DO NOTHING
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'marketing_events_seed_v1') THEN
          INSERT INTO marketing_events (name, start_date, end_date, offer, status, source) VALUES
            ('Summer Holiday Free Pack', '2026-07-20', '2026-09-01', 'Free pack offer while the schools are out', 'planned', 'manual'),
            ('Black Friday', '2026-11-23', '2026-11-30', 'Biggest offer of the year — plan stock early', 'planned', 'manual');
          INSERT INTO _migrations_done (key) VALUES ('marketing_events_seed_v1');
        END IF;
      END $$;
    `);

    // Founder settings — see lib/db/migrations/0036_founder_settings.sql.
    // Founder-only k/v (CalDAV credentials etc.) — kept out of app_settings
    // because that table is readable by ordinary logged-in users.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS founder_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Merge the four prep-section checklists into one canonical 'prep'
    // checklist — see lib/db/migrations/0038_prep_checklist_merge.sql for
    // the full rationale. Every completion row is preserved (HACCP trail):
    // duplicates of a canonical item hand their ticks to it (first tick per
    // plan wins the unique slot) and deactivate; unique items move over.
    await db.execute(sql`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'prep_checklist_merge_v1') THEN
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

          UPDATE checklist_templates dup
          SET is_active = false
          WHERE dup.station_type IN ('main_prep', 'prep_bases', 'prep_meat')
            AND EXISTS (
              SELECT 1 FROM checklist_templates keep
              WHERE keep.station_type = 'prep'
                AND keep.category = dup.category
                AND lower(btrim(keep.title)) = lower(btrim(dup.title))
            );

          UPDATE checklist_completions cc
          SET station_type = 'prep'
          FROM checklist_templates t
          WHERE t.id = cc.template_id
            AND t.station_type IN ('main_prep', 'prep_bases', 'prep_meat');

          UPDATE checklist_templates
          SET station_type = 'prep'
          WHERE station_type IN ('main_prep', 'prep_bases', 'prep_meat');

          UPDATE checklist_oneoff_items
          SET station_type = 'prep'
          WHERE station_type IN ('main_prep', 'prep_bases', 'prep_meat');

          INSERT INTO _migrations_done (key) VALUES ('prep_checklist_merge_v1');
        END IF;
      END $$;
    `);

    // Morning-meeting "Who's On Today" slide — see
    // lib/db/migrations/0040_station_assignments_slide.sql. Maps Planday
    // rota positions onto planner stations; mapping lives in app_settings
    // (ON CONFLICT DO NOTHING so admin edits survive restarts) and the
    // slide is inserted into the default template just before Order of
    // Production, once.
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at) VALUES (
        'station_assignments_mapping',
        '{"stations":[{"title":"Dough Prep","positions":["Dough Prep","Dough Mixing"]},{"title":"Dough Sheeting","positions":["Dough"]},{"title":"Mixing","positions":["Mixing Prep"]},{"title":"Prep","positions":["OG Prep"],"hideWhenEmpty":true},{"title":"Building Table 1","positions":["Builder 1"]},{"title":"Building Table 2","positions":["Builder 2"]},{"title":"Ovens","positions":["Ovens"]},{"title":"Fried Chicken","positions":["Frying","Breading"]},{"title":"Wrapping","positions":["Wrapper"]},{"title":"Packing","positions":["Packer"]}]}',
        NOW()
      ) ON CONFLICT (key) DO NOTHING
    `);
    await db.execute(sql`
      DO $$
      DECLARE
        target_pos INTEGER;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'station_assignments_slide_v1') THEN
          SELECT order_position INTO target_pos FROM template_slides
          WHERE template_id = 1 AND kind = 'order_of_production' LIMIT 1;
          IF target_pos IS NOT NULL THEN
            -- Insert first, then shift everything else at/after that slot —
            -- excluding the new row itself — so the new slide provably owns
            -- the slot regardless of statement ordering quirks.
            INSERT INTO template_slides (template_id, kind, title, order_position)
            VALUES (1, 'station_assignments', 'Who''s On Today', target_pos);
            UPDATE template_slides SET order_position = order_position + 1
            WHERE template_id = 1 AND order_position >= target_pos
              AND kind <> 'station_assignments';
          END IF;
          INSERT INTO _migrations_done (key) VALUES ('station_assignments_slide_v1');
        END IF;
      END $$;
    `);

    // Weekly lean focus — see lib/db/migrations/0041_lean_week_focus.sql.
    // One curriculum principle per week; a row here pins a specific week
    // to a chosen principle ("next week we're doing Leave It Better Than
    // You Found It"), otherwise the curriculum rotates weekly. Also renames
    // the week-2 principle to the Lean Made Simple wording — DOWNTIME is
    // the generic acronym whose terminology Graeme explicitly doesn't use.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS lean_week_focus (
        week_start DATE PRIMARY KEY,
        principle_id INTEGER NOT NULL REFERENCES lean_principles(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      UPDATE lean_principles SET title = 'The 8 Wastes'
      WHERE title = 'The 8 Wastes — DOWNTIME'
    `);
    await db.execute(sql`
      UPDATE lean_principles
      SET summary = 'Overproduction, Transportation, Inventory, Defects, Motion, Overprocessing, Waiting, Waste of Skills.'
      WHERE title = 'The 8 Wastes' AND summary ~* 'non.?utili[sz]ed'
    `);

    // APC label-scan ledger — see lib/db/migrations/0031_add_apc_consignments.sql.
    // The UNIQUE waybill is what stops one physical label being scanned onto
    // two orders, so this table must exist before the packing flow runs.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS apc_consignments (
        id SERIAL PRIMARY KEY,
        waybill TEXT NOT NULL UNIQUE,
        reference TEXT,
        shopify_order_id BIGINT,
        shopify_order_name TEXT,
        consignee_name TEXT,
        consignee_postcode TEXT,
        scanned_barcode TEXT,
        tracking_url TEXT,
        verified_at TIMESTAMP NOT NULL DEFAULT NOW(),
        verified_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        verified_by_name TEXT,
        pushed_to_shopify_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_apc_consignments_order ON apc_consignments (shopify_order_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_apc_consignments_verified ON apc_consignments (verified_at)`);
    // Seed apc_mode from the existing apc_enabled boolean so no environment
    // silently changes courier behaviour on deploy.
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      SELECT 'apc_mode',
             CASE WHEN COALESCE((SELECT value FROM app_settings WHERE key = 'apc_enabled'), 'true') = 'false'
                  THEN 'off' ELSE 'full' END,
             NOW()
      ON CONFLICT (key) DO NOTHING
    `);

    // Digital visitor book — see lib/db/migrations/0030_add_visitor_log.sql.
    // The check-in screen and the HACCP → Visitor Book log both query this
    // unconditionally, so it must exist on every environment.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS visitor_log (
        id SERIAL PRIMARY KEY,
        visitor_name TEXT NOT NULL,
        company TEXT,
        visiting TEXT,
        purpose TEXT,
        illness_last_48h BOOLEAN NOT NULL,
        jewellery_removed BOOLEAN NOT NULL DEFAULT FALSE,
        ppe_agreed BOOLEAN NOT NULL DEFAULT FALSE,
        entry_permitted BOOLEAN NOT NULL DEFAULT TRUE,
        signed_in_at TIMESTAMP NOT NULL DEFAULT NOW(),
        signed_out_at TIMESTAMP,
        recorded_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        recorded_by_name TEXT,
        signed_out_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        signed_out_by_name TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_visitor_log_signed_in ON visitor_log (signed_in_at)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS prep_tin_overrides (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE CASCADE,
        tin_count INTEGER NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(plan_id, recipe_id, ingredient_id)
      )
    `);

    // Prep deferrals — see lib/db/migrations/0018_add_prep_deferrals.sql.
    // /main-prep and /prep-progress query this table unconditionally, so it
    // must exist on every environment or those endpoints 500 and the Main
    // Prep / Bases stations render empty.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS prep_deferrals (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
        ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE CASCADE,
        sub_recipe_id INTEGER REFERENCES sub_recipes(id),
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        tin_number INTEGER NOT NULL,
        deferred_to_date DATE NOT NULL,
        user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        deferred_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_prep_deferral_ing
        ON prep_deferrals (plan_id, ingredient_id, COALESCE(sub_recipe_id, 0), recipe_id, tin_number)
        WHERE ingredient_id IS NOT NULL
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_prep_deferral_sub
        ON prep_deferrals (plan_id, sub_recipe_id, recipe_id, tin_number)
        WHERE sub_recipe_id IS NOT NULL AND ingredient_id IS NULL
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS ix_prep_deferral_target
        ON prep_deferrals (deferred_to_date)
    `);

    // Leftover filling weight tracking
    await db.execute(sql`ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS leftover_filling_grams INTEGER`);
    await db.execute(sql`ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS leftover_filling_comment TEXT`);

    // Label Stock Check tool — see lib/db/migrations/0019 + 0020. Without
    // these tables, /api/label-stock/ 500s and the page fires its red
    // "Failed to load" toast on every page open.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS label_recipes (
        id serial PRIMARY KEY,
        recipe_id integer REFERENCES recipes(id) ON DELETE CASCADE,
        misc_name text,
        misc_dpt_pct numeric(6,3),
        mapped_recipe_id integer REFERENCES recipes(id) ON DELETE SET NULL,
        hidden boolean NOT NULL DEFAULT false,
        notes text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT label_recipes_kind_check CHECK (
          (recipe_id IS NOT NULL AND misc_name IS NULL)
          OR (recipe_id IS NULL AND misc_name IS NOT NULL)
        )
      )
    `);
    await db.execute(sql`ALTER TABLE label_recipes ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_label_recipe_real
        ON label_recipes (recipe_id) WHERE recipe_id IS NOT NULL
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_label_recipe_misc
        ON label_recipes (misc_name) WHERE misc_name IS NOT NULL
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_label_recipes_hidden ON label_recipes (hidden)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS label_stock_checks (
        id serial PRIMARY KEY,
        label_recipe_id integer NOT NULL REFERENCES label_recipes(id) ON DELETE CASCADE,
        num_rolls integer NOT NULL,
        total_weight_g numeric(12,3) NOT NULL,
        empty_roll_weight_g_used numeric(10,3) NOT NULL,
        label_weight_g_used numeric(10,4) NOT NULL,
        computed_count integer NOT NULL,
        user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
        checked_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS ix_label_stock_check_recipe_time
        ON label_stock_checks (label_recipe_id, checked_at DESC)
    `);
    await db.execute(sql`INSERT INTO app_settings (key, value, updated_at) VALUES ('label_empty_roll_weight_g', '0', now()) ON CONFLICT (key) DO NOTHING`);
    await db.execute(sql`INSERT INTO app_settings (key, value, updated_at) VALUES ('label_label_weight_g', '0', now()) ON CONFLICT (key) DO NOTHING`);
    await db.execute(sql`INSERT INTO app_settings (key, value, updated_at) VALUES ('label_default_order_qty', '30000', now()) ON CONFLICT (key) DO NOTHING`);

    // Batches/hour KPI is now builders-only — drop legacy timing_standards rows
    // for stations we no longer track (mixing, dough_prep, dough_sheeting,
    // ovens, wrapping, packing). The Settings → Station Timing Standards
    // table will only show building_1 and building_2 going forward.
    await db.execute(sql`
      DELETE FROM timing_standards
      WHERE station_type NOT IN ('building_1', 'building_2')
    `);

    // Risk assessments feature
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS risk_assessments (
        id                         SERIAL PRIMARY KEY,
        assessment_type            TEXT NOT NULL,
        title                      TEXT NOT NULL,
        body_markdown              TEXT NOT NULL DEFAULT '',
        status                     TEXT NOT NULL DEFAULT 'draft',
        review_frequency_months    INTEGER NOT NULL DEFAULT 12,
        last_reviewed_at           TIMESTAMP,
        next_review_due            DATE,
        last_reviewed_by_user_id   INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        last_reviewed_by_name      TEXT,
        reviewer_qualifications    TEXT,
        created_at                 TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at                 TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS compliance_actions (
        id                         SERIAL PRIMARY KEY,
        risk_assessment_id         INTEGER REFERENCES risk_assessments(id) ON DELETE SET NULL,
        title                      TEXT NOT NULL,
        description                TEXT,
        category                   TEXT NOT NULL DEFAULT 'other',
        priority                   TEXT NOT NULL DEFAULT 'medium',
        status                     TEXT NOT NULL DEFAULT 'open',
        assigned_to_user_id        INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        assigned_to_name           TEXT,
        due_date                   DATE,
        recurrence                 TEXT NOT NULL DEFAULT 'none',
        parent_action_id           INTEGER,
        completed_at               TIMESTAMP,
        completed_by_user_id       INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        completed_by_name          TEXT,
        completion_notes           TEXT,
        created_at                 TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at                 TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS compliance_actions_status_due_idx ON compliance_actions (status, due_date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS compliance_actions_ra_idx ON compliance_actions (risk_assessment_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS compliance_actions_parent_idx ON compliance_actions (parent_action_id)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS compliance_action_completions (
        id                         SERIAL PRIMARY KEY,
        action_id                  INTEGER NOT NULL REFERENCES compliance_actions(id) ON DELETE CASCADE,
        completed_at               TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_by_user_id       INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        completed_by_name          TEXT NOT NULL,
        notes                      TEXT,
        next_action_id             INTEGER
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS compliance_completions_action_idx ON compliance_action_completions (action_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS compliance_completions_at_idx ON compliance_action_completions (completed_at)`);

    // Documents repository — extend risk_assessments with file storage so it
    // can hold PDFs (insurance, certifications, licences, SOPs etc), not just
    // markdown bodies. See lib/db/migrations/0015_documents_files.sql.
    await db.execute(sql`ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS file_blob          BYTEA`);
    await db.execute(sql`ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS file_mime          TEXT`);
    await db.execute(sql`ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS file_name          TEXT`);
    await db.execute(sql`ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS file_size_bytes    INTEGER`);
    await db.execute(sql`ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS file_version       TEXT`);
    await db.execute(sql`ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS file_uploaded_at   TIMESTAMP`);
    await db.execute(sql`ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS original_issue_date DATE`);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS risk_assessments_next_review_idx
        ON risk_assessments (next_review_due)
        WHERE status <> 'archived'
    `);

    // Jewellery & Body Piercings Policy — first document of the 'policy'
    // category. Single source of truth: this one risk_assessments row is THE
    // policy; the Employee Hub, the HACCP evidence tab and the training
    // matrix all link to it rather than carrying copies. Also appended to
    // the New Colleague Onboarding matrix (sop_id link) so every new starter
    // gets a sign-off record against it. See
    // lib/db/migrations/0044_jewellery_policy.sql.
    const jewellerySeedDone = await db.execute<{ key: string }>(
      sql`SELECT key FROM _migrations_done WHERE key = 'jewellery_policy_seed_v1'`,
    );
    if (jewellerySeedDone.rows.length === 0) {
      const policyDoc = await db.execute<{ id: number }>(sql`
        INSERT INTO risk_assessments
          (assessment_type, title, body_markdown, status, review_frequency_months, original_issue_date, last_reviewed_at, next_review_due)
        VALUES
          ('policy', 'Jewellery & Body Piercings Policy', ${JEWELLERY_POLICY_MARKDOWN}, 'active', 12, CURRENT_DATE, NOW(), (CURRENT_DATE + INTERVAL '12 months')::date)
        RETURNING id
      `);
      const policyId = policyDoc.rows[0].id;
      // Training tables are created outside startup migrations, so guard on
      // their existence before wiring the onboarding item.
      const hasTraining = await db.execute<{ ok: string | null }>(
        sql`SELECT to_regclass('public.training_matrix_items')::text AS ok`,
      );
      if (hasTraining.rows[0]?.ok) {
        await db.execute(sql`
          INSERT INTO training_matrix_items (matrix_id, label, sop_id, sort_order)
          SELECT m.id, 'Jewellery & Body Piercings Policy — read & signed off', ${policyId},
                 COALESCE((SELECT MAX(i.sort_order) FROM training_matrix_items i WHERE i.matrix_id = m.id), -1) + 1
          FROM training_matrices m
          WHERE m.name = 'New Colleague Onboarding'
        `);
      }
      await db.execute(sql`INSERT INTO _migrations_done (key) VALUES ('jewellery_policy_seed_v1')`);
    }

    // Periodic checklist schedule — every-4-weeks tasks (13 periods/year).
    // See lib/db/migrations/0045_periodic_checklists.sql.
    await db.execute(sql`ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS schedule_anchor_date DATE`);

    // Notifications table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        andon_issue_id INTEGER REFERENCES andon_issues(id) ON DELETE CASCADE,
        read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id) WHERE read = FALSE`);

    // Expand sub-recipe ingredients in prep station
    await db.execute(sql`ALTER TABLE sub_recipes ADD COLUMN IF NOT EXISTS expand_in_prep BOOLEAN NOT NULL DEFAULT FALSE`);

    // Ensure reports page is accessible to all users (for Issue Log)
    await db.execute(sql`
      INSERT INTO page_permissions (page_key, min_role)
      VALUES ('/reports', 'viewer')
      ON CONFLICT (page_key) DO UPDATE SET min_role = 'viewer'
    `);

    // Mark Incomplete support on station checklists — adds the skipped_reason
    // column read/written by the checklist routes. Without this, the GET
    // /api/checklists/station/:stationType/plan/:planId query fails on any
    // DB that predates the feature and the station UI hangs on "Loading
    // checklist...".
    await db.execute(sql`ALTER TABLE checklist_completions ADD COLUMN IF NOT EXISTS skipped_reason TEXT`);
    await db.execute(sql`ALTER TABLE checklist_oneoff_items ADD COLUMN IF NOT EXISTS skipped_reason TEXT`);

    // Builder-controlled recipe completion — see
    // lib/db/migrations/0009_add_builder_marked_complete_at.sql
    await db.execute(sql`ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS builder_marked_complete_at TIMESTAMP`);

    // Race-safe building completion (see migrations/0017_…). Decouples
    // partial-batch recording from recipe close, and gates the close on a
    // live presence ping so one builder can't lock the recipe while the
    // other is mid-batch. Also adds the admin "Add missed batch" audit
    // columns on batch_completions.
    await db.execute(sql`ALTER TABLE batch_completions ADD COLUMN IF NOT EXISTS partial_packs INTEGER`);
    await db.execute(sql`ALTER TABLE batch_completions ADD COLUMN IF NOT EXISTS correction_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE batch_completions ADD COLUMN IF NOT EXISTS correction_note TEXT`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS builder_presence (
        id SERIAL PRIMARY KEY,
        plan_item_id INTEGER NOT NULL REFERENCES production_plan_items(id) ON DELETE CASCADE,
        station_type TEXT NOT NULL,
        user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_builder_presence UNIQUE (plan_item_id, station_type)
      )
    `);

    // Per-builder building-station progress. Each of the two builders tracks
    // their own loose extra packs and their own "moved on" state independently;
    // the server derives production_plan_items.extra_packs_built (= SUM) and
    // builder_marked_complete_at (= both moved on) from these rows.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS building_station_progress (
        id SERIAL PRIMARY KEY,
        plan_item_id INTEGER NOT NULL REFERENCES production_plan_items(id) ON DELETE CASCADE,
        station_type TEXT NOT NULL,
        extra_packs INTEGER NOT NULL DEFAULT 0,
        moved_on_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_building_station_progress UNIQUE (plan_item_id, station_type)
      )
    `);

    // Oven-station batch weight records (HACCP cooling log + variance tracking).
    // Every oven batch gets a row with the actual pack weight, the computed
    // target (tray + pack_size × portion), and the variance. The final batch
    // for a recipe flips is_last_batch_of_recipe and its recorded_at is the
    // chill-start timestamp. chill_end_at is stamped by the Mark as Chilled
    // button on the oven or wrapping station.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS batch_weight_records (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
        plan_item_id INTEGER NOT NULL REFERENCES production_plan_items(id) ON DELETE CASCADE,
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        batch_sequence INTEGER NOT NULL,
        tray_weight_g NUMERIC(7,2) NOT NULL,
        portion_weight_g NUMERIC(7,2) NOT NULL,
        pack_size INTEGER NOT NULL,
        target_weight_g NUMERIC(7,2) NOT NULL,
        actual_weight_g NUMERIC(7,2) NOT NULL,
        variance_g NUMERIC(7,2) NOT NULL,
        tolerance_under_g NUMERIC(7,2) NOT NULL DEFAULT 0,
        tolerance_over_g NUMERIC(7,2) NOT NULL DEFAULT 0,
        within_tolerance BOOLEAN NOT NULL,
        is_last_batch_of_recipe BOOLEAN NOT NULL DEFAULT FALSE,
        chill_end_at TIMESTAMP,
        chilled_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        chilled_via TEXT,
        user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_bwr_plan_recipe ON batch_weight_records (plan_id, recipe_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_bwr_last_batch ON batch_weight_records (plan_id, recipe_id) WHERE is_last_batch_of_recipe = TRUE`);

    // Seed defaults for the new weight/chill app_settings keys.
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES
        ('tray_weight_g', '36', NOW()),
        ('chill_target_temp_c', '4', NOW()),
        ('weight_tolerance_under_g', '0', NOW()),
        ('weight_tolerance_over_g', '0', NOW())
      ON CONFLICT (key) DO NOTHING
    `);

    // Morning Meeting feature: lean curriculum + meeting log + gratitude.
    // Safety issues + struggles raised during the meeting are written into
    // the existing andon_issues / improvement_submissions tables.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS lean_lessons (
        id SERIAL PRIMARY KEY,
        week_number INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        explanation_md TEXT NOT NULL,
        what_to_show_md TEXT NOT NULL,
        delivery_notes_md TEXT NOT NULL,
        video_url TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Phase-2 curriculum split: weekly principle → daily examples.
    // Old `lean_lessons` rows are backfilled into these tables on
    // startup (see seedLeanLessonsIfNeeded) and kept read-only for the
    // migration window.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS lean_principles (
        id SERIAL PRIMARY KEY,
        week_position INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS lean_examples (
        id SERIAL PRIMARY KEY,
        principle_id INTEGER NOT NULL REFERENCES lean_principles(id) ON DELETE CASCADE,
        order_position INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        explanation_md TEXT NOT NULL,
        what_to_show_md TEXT NOT NULL,
        delivery_notes_md TEXT NOT NULL,
        video_url TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS lean_examples_principle_idx ON lean_examples (principle_id, order_position)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS morning_meetings (
        id SERIAL PRIMARY KEY,
        meeting_date DATE NOT NULL UNIQUE,
        host_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        host_name TEXT,
        lesson_id INTEGER REFERENCES lean_lessons(id) ON DELETE SET NULL,
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMP
      )
    `);
    // example_id added in Phase 2 — points at the picked lean_example
    // for this meeting's lesson slide. Old lesson_id stays for now.
    await db.execute(sql`ALTER TABLE morning_meetings ADD COLUMN IF NOT EXISTS example_id INTEGER REFERENCES lean_examples(id) ON DELETE SET NULL`);
    // Templates + slides (Phase 2). The default template seeds the
    // 12-slide morning meeting; meetings clone its slides on creation
    // so per-day edits don't touch the master.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS meeting_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS template_slides (
        id SERIAL PRIMARY KEY,
        template_id INTEGER NOT NULL REFERENCES meeting_templates(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        order_position INTEGER NOT NULL DEFAULT 0,
        content_md TEXT,
        config_json JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS template_slides_template_idx ON template_slides (template_id, order_position)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS meeting_slides (
        id SERIAL PRIMARY KEY,
        meeting_id INTEGER NOT NULL REFERENCES morning_meetings(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        order_position INTEGER NOT NULL DEFAULT 0,
        content_md TEXT,
        config_json JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS meeting_slides_meeting_idx ON meeting_slides (meeting_id, order_position)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS meeting_gratitude (
        id SERIAL PRIMARY KEY,
        meeting_id INTEGER NOT NULL REFERENCES morning_meetings(id) ON DELETE CASCADE,
        from_name TEXT NOT NULL,
        to_name TEXT,
        content TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Recipe tags — see lib/db/migrations/0016_add_recipe_tags.sql
    await db.execute(sql`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS recipes_tags_gin_idx ON recipes USING GIN (tags)`);

    // SKU → barcode cache — see lib/db/migrations/0017_add_sku_barcodes.sql
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sku_barcodes (
        sku            text PRIMARY KEY,
        barcode        text NOT NULL,
        product_title  text,
        variant_title  text,
        updated_at     timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS sku_barcodes_barcode_idx ON sku_barcodes (barcode)`);
    await db.execute(sql`ALTER TABLE sku_barcodes ADD COLUMN IF NOT EXISTS image_url text`);

    // Lean curriculum anchor — start the rotation from week 1 on the
    // day this seed first runs, instead of being pinned to the
    // calendar week of the year (which dropped users mid-curriculum).
    // Idempotent — only sets the date once.
    await db.execute(sql`
      INSERT INTO app_settings (key, value)
      SELECT 'lean_curriculum_start_date', to_char(CURRENT_DATE, 'YYYY-MM-DD')
      WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'lean_curriculum_start_date')
    `);

    // Morning meeting — reorder slides + rename "Special Prep" →
    // "Test Product Prep" and "Local Delivery" → "Local Despatch" on
    // the default template (and on any future cloned meetings that
    // still carry the legacy titles). Idempotent.
    //
    // System Updates slide REMOVED (2026-07-15, Graeme): the slide never
    // reliably showed fresh content on prod, so it's pulled from the template
    // and from meetings that haven't run yet. One-time guarded delete — the
    // slide used to be seeded right here on every boot, so a plain data
    // delete would have been resurrected at the next deploy. Guarding (rather
    // than deleting unconditionally) also means a manual re-add through the
    // template editor sticks, if it ever comes back.
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'remove_system_updates_slide_v1') THEN
          DELETE FROM template_slides WHERE kind = 'system_updates';
          -- Only from meetings that haven't run yet (ended_at NULL) — meetings
          -- already held keep their slide list as a historical record.
          DELETE FROM meeting_slides ms
          USING morning_meetings mm
          WHERE ms.meeting_id = mm.id
            AND ms.kind = 'system_updates'
            AND mm.ended_at IS NULL;
          INSERT INTO _migrations_done (key) VALUES ('remove_system_updates_slide_v1');
        END IF;
      END $$;
    `);
    // System Updates slide RE-ADDED (2026-08-10, Graeme): the automatic
    // change-feed validation now works, so the slide returns to the default
    // template in its old slot (position 7 — the gap left by the removal).
    // Same guarded one-shot pattern as the removal above: if the team pulls
    // it via the template editor again, later deploys won't resurrect it.
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'readd_system_updates_slide_v1') THEN
          INSERT INTO template_slides (template_id, kind, title, order_position)
          SELECT mt.id, 'system_updates', 'System Updates', 7
          FROM meeting_templates mt
          WHERE mt.is_default = true
            AND NOT EXISTS (
              SELECT 1 FROM template_slides ts
              WHERE ts.template_id = mt.id AND ts.kind = 'system_updates'
            );
          -- Meetings already prepared but not yet held pick the slide up too,
          -- so it doesn't miss a meeting whose slides were cloned early.
          INSERT INTO meeting_slides (meeting_id, kind, title, order_position)
          SELECT mm.id, 'system_updates', 'System Updates', 7
          FROM morning_meetings mm
          WHERE mm.ended_at IS NULL
            AND EXISTS (SELECT 1 FROM meeting_slides ms WHERE ms.meeting_id = mm.id)
            AND NOT EXISTS (
              SELECT 1 FROM meeting_slides ms
              WHERE ms.meeting_id = mm.id AND ms.kind = 'system_updates'
            );
          INSERT INTO _migrations_done (key) VALUES ('readd_system_updates_slide_v1');
        END IF;
      END $$;
    `);
    // Who's On Today leads the meeting (Graeme, 2026-08-11): the rota is
    // the first thing the room needs, before stretches. Slides 0-4 shift
    // down one; the 4 slot the old numbering skipped gets used.
    await db.execute(sql`
      UPDATE template_slides ts
      SET order_position = m.new_pos, title = m.new_title
      FROM (VALUES
        ('station_assignments'::text, 0, 'Who''s On Today'::text),
        ('stretches', 1, 'Stretches'),
        ('safety_issues', 2, 'Safety Issues'),
        ('order_of_production', 3, 'Order of Production'),
        ('special_prep', 4, 'Test Product Prep'),
        ('local_delivery', 5, 'Local Despatch'),
        ('bag_orders', 6, 'Bag Orders'),
        ('yesterday_kpis', 8, 'Yesterday''s Numbers'),
        ('new_sops', 9, 'New & Updated SOPs'),
        ('struggles', 10, 'Improvements Required'),
        ('lesson', 11, 'Today''s Lean Lesson'),
        ('gratitude', 12, 'Gratitude')
      ) AS m(kind, new_pos, new_title)
      WHERE ts.kind = m.kind
        AND ts.template_id IN (SELECT id FROM meeting_templates WHERE is_default = true)
    `);
    await db.execute(sql`
      UPDATE meeting_slides ms
      SET order_position = m.new_pos,
          title = CASE WHEN ms.title IN ('Special Prep','Local Delivery','Struggles') THEN m.new_title ELSE ms.title END
      FROM (VALUES
        ('station_assignments'::text, 0, 'Who''s On Today'::text),
        ('stretches', 1, 'Stretches'),
        ('safety_issues', 2, 'Safety Issues'),
        ('order_of_production', 3, 'Order of Production'),
        ('special_prep', 4, 'Test Product Prep'),
        ('local_delivery', 5, 'Local Despatch'),
        ('bag_orders', 6, 'Bag Orders'),
        ('yesterday_kpis', 8, 'Yesterday''s Numbers'),
        ('new_sops', 9, 'New & Updated SOPs'),
        ('struggles', 10, 'Improvements Required'),
        ('lesson', 11, 'Today''s Lean Lesson'),
        ('gratitude', 12, 'Gratitude')
      ) AS m(kind, new_pos, new_title)
      WHERE ms.kind = m.kind
    `);

    // Retire the standalone "Short on the Pack" slide — its stock data is
    // now folded into the Order of Production slide (colour-coded Have/Need
    // columns). Drop any lingering short_on_pack slides from the default
    // template and from existing meetings so the merged slide is the single
    // source of truth. Idempotent.
    await db.execute(sql`DELETE FROM template_slides WHERE kind = 'short_on_pack'`);
    await db.execute(sql`DELETE FROM meeting_slides WHERE kind = 'short_on_pack'`);

    // Engagement media for Lean lesson examples: a code-diagram key and an
    // optional photo URL. Idempotent ADD COLUMN IF NOT EXISTS.
    await db.execute(sql`ALTER TABLE lean_examples ADD COLUMN IF NOT EXISTS diagram text`);
    await db.execute(sql`ALTER TABLE lean_examples ADD COLUMN IF NOT EXISTS image_url text`);

    // Dedicated supplier ordering phone (WhatsApp) — separate from `phone`.
    await db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ordering_phone text`);

    // Case size (in packs) for case-rounding the order quantity. Null = order
    // in individual packs. Only affects the orders page; stock check unchanged.
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS case_size_packs INTEGER`);

    // Optional photo + caption for the morning-meeting gratitude slide. Stored
    // per-day on the meeting row; NULL falls back to a live themed image.
    await db.execute(sql`ALTER TABLE morning_meetings ADD COLUMN IF NOT EXISTS gratitude_photo BYTEA`);
    await db.execute(sql`ALTER TABLE morning_meetings ADD COLUMN IF NOT EXISTS gratitude_photo_mime TEXT`);
    await db.execute(sql`ALTER TABLE morning_meetings ADD COLUMN IF NOT EXISTS gratitude_caption TEXT`);

    // Govee temperature-sensor integration: discovered sensors (mapped to
    // storage locations + cached latest reading), append-only reading history,
    // and web-push subscriptions for alerts. All additive — safe to re-run.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS govee_sensors (
        id                    SERIAL PRIMARY KEY,
        device                TEXT NOT NULL UNIQUE,
        sku                   TEXT NOT NULL DEFAULT '',
        name                  TEXT NOT NULL DEFAULT '',
        storage_location_id   INTEGER REFERENCES storage_locations(id) ON DELETE SET NULL,
        enabled               BOOLEAN NOT NULL DEFAULT TRUE,
        last_temperature_c    NUMERIC(5,1),
        last_humidity_percent INTEGER,
        last_online           BOOLEAN,
        last_reading_at       TIMESTAMP,
        created_at            TIMESTAMP NOT NULL DEFAULT now(),
        updated_at            TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS govee_readings (
        id               SERIAL PRIMARY KEY,
        device           TEXT NOT NULL,
        temperature_c    NUMERIC(5,1),
        humidity_percent INTEGER,
        online           BOOLEAN NOT NULL DEFAULT TRUE,
        recorded_at      TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_govee_readings_device_time ON govee_readings (device, recorded_at)`);
    // True freshness clock — advances only while the sensor is online, so a
    // dead battery leaves it frozen (see govee schema). Additive.
    await db.execute(sql`ALTER TABLE govee_sensors ADD COLUMN IF NOT EXISTS last_online_at TIMESTAMP`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        endpoint     TEXT NOT NULL UNIQUE,
        p256dh       TEXT NOT NULL,
        auth         TEXT NOT NULL,
        user_agent   TEXT,
        created_at   TIMESTAMP NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_push_subscriptions_user ON push_subscriptions (user_id)`);

    // Append-only audit log of every production-fridge stock change (manual
    // checks/adjustments, wrapping additions, despatch decrements). The
    // aggregate stock_entries row stays the live total; this records each delta
    // so the team can see what built the number up day to day.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS fridge_stock_changes (
        id serial PRIMARY KEY,
        recipe_id integer NOT NULL,
        pack_size integer NOT NULL DEFAULT 2,
        delta integer NOT NULL,
        resulting_qty integer NOT NULL,
        source text NOT NULL,
        user_id integer,
        note text,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_fridge_stock_changes_recipe_pack_time
        ON fridge_stock_changes (recipe_id, pack_size, created_at DESC)
    `);

    // Production-schedule timeline — see lib/db/migrations/0022_add_meat_process_minutes.sql.
    // Per-raw-meat total lead time (cook + processing) used to compute the
    // "get the meat in by" time for each recipe on the day's timeline.
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS meat_process_minutes integer`);
    // Forward-planning settings: building start time + changeover gap.
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at) VALUES
        ('building_start_time', '07:00', NOW()),
        ('changeover_seconds', '90', NOW())
      ON CONFLICT (key) DO NOTHING
    `);
    // Correct the lunch allowance 45 -> 35 once. Guarded so a later manual edit
    // in Settings is never clobbered on subsequent boots.
    await db.execute(sql`CREATE TABLE IF NOT EXISTS _migrations_done (key TEXT PRIMARY KEY, done_at TIMESTAMP DEFAULT NOW())`);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'default_lunch_minutes_35_v1') THEN
          INSERT INTO app_settings (key, value, updated_at)
          SELECT 'default_lunch_minutes', '35', NOW()
          WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'default_lunch_minutes');
          UPDATE app_settings SET value = '35', updated_at = NOW() WHERE key = 'default_lunch_minutes';
          INSERT INTO _migrations_done (key) VALUES ('default_lunch_minutes_35_v1');
        END IF;
      END $$;
    `);

    // Product specification sheets (BRC-style trade specs). Country of origin
    // on ingredients; per-recipe spec detail; single-row company/site profile.
    // See lib/db/src/schema/product_specifications.ts.
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS country_of_origin text`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS product_specifications (
        id SERIAL PRIMARY KEY,
        recipe_id INTEGER NOT NULL UNIQUE REFERENCES recipes(id) ON DELETE CASCADE,
        legal_name TEXT,
        product_description TEXT,
        intended_use TEXT,
        storage_instructions TEXT,
        usage_instructions TEXT,
        may_contain_override TEXT,
        packaging_spec JSONB,
        organoleptic_standards JSONB,
        micro_criteria JSONB,
        dietary_suitability TEXT,
        spec_version INTEGER NOT NULL DEFAULT 1,
        spec_status TEXT NOT NULL DEFAULT 'draft',
        prepared_by TEXT,
        approved_by TEXT,
        approved_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS company_profile (
        id INTEGER PRIMARY KEY DEFAULT 1,
        legal_business_name TEXT,
        trading_name TEXT,
        site_address TEXT,
        fbo_registration_number TEXT,
        local_authority TEXT,
        certification_status TEXT,
        technical_contact_name TEXT,
        technical_contact_email TEXT,
        technical_contact_phone TEXT,
        emergency_contact TEXT,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Per-plan extra/test dough — see lib/db/migrations/0026_add_plan_extra_dough.sql.
    // Added from the plan detail page; surfaced on the dough station balling view.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS production_plan_extra_dough (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
        label TEXT NOT NULL DEFAULT 'Test dough',
        ball_count INTEGER NOT NULL,
        ball_weight_g INTEGER NOT NULL,
        created_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Ingredient → Shopify variant link: goods-in pushes received stock of
    // mapped bought-in items (e.g. Cakehead brownies) straight to Shopify.
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS shopify_variant_id TEXT`);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS shopify_product_title TEXT`);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS shopify_variant_title TEXT`);
    await db.execute(sql`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS shopify_units_per_pack NUMERIC(10,2)`);

    // Timed station reminders — seed the two launch defaults once (2:45pm
    // warnings counting down to 3pm: stock checks on Prep, the daily count on
    // Wrapping/Packing). Managed afterwards in Settings → Production → Timed
    // reminders; the guard means later edits/deletes are never re-seeded.
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'timed_station_reminders_seed_v1') THEN
          INSERT INTO app_settings (key, value, updated_at)
          SELECT 'timed_station_reminders', '${sql.raw(JSON.stringify([
            {
              id: "stock-checks-1445",
              title: "Stock checks due by 3pm",
              message: "Record any outstanding stock check items before 3:00pm.",
              stations: ["prep"],
              startTime: "14:45",
              endTime: "15:00",
              enabled: true,
              onlyIfStockChecksOutstanding: true,
            },
            {
              id: "pack-count-1445",
              title: "Completed count due by 3pm",
              message: "Please complete today's count before 3:00pm.",
              stations: ["wrapping", "packing"],
              startTime: "14:45",
              endTime: "15:00",
              enabled: true,
            },
          ]).replace(/'/g, "''"))}', NOW()
          WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'timed_station_reminders');
          INSERT INTO _migrations_done (key) VALUES ('timed_station_reminders_seed_v1');
        END IF;
      END $$;
    `);

    // NOVA / UPF classification on ingredients — see
    // lib/db/migrations/0027_add_upf_nova.sql. nova_class 1-4 (4 = UPF),
    // null = not yet classified. Rolled up into recipe/sub-recipe UPF %
    // by weight in routes/upf.ts.
    await db.execute(sql`
      ALTER TABLE ingredients
        ADD COLUMN IF NOT EXISTS nova_class integer,
        ADD COLUMN IF NOT EXISTS nova_markers jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS nova_reasoning text,
        ADD COLUMN IF NOT EXISTS nova_confidence text,
        ADD COLUMN IF NOT EXISTS nova_source text,
        ADD COLUMN IF NOT EXISTS nova_analyzed_at timestamp
    `);

    // Forced password reset with 24h grace — see
    // lib/db/migrations/0046_password_reset_policy.sql. No boot-time seed:
    // each user's 24h clock starts the first time they authenticate after
    // this ships (stamped in routes/auth.ts), so someone who first logs in
    // on Wednesday gets the same full day's warning as someone who logged
    // in on Monday. The founder is exempt.
    await db.execute(sql`
      ALTER TABLE app_users
        ADD COLUMN IF NOT EXISTS password_reset_deadline TIMESTAMP,
        ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP
    `);

    // Customer surveys — see lib/db/migrations/0047_surveys.sql. Pure
    // additive table creation (idempotent by construction); the
    // _migrations_done marker just records when the schema first landed.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS surveys (
        id SERIAL PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        intro TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS survey_questions (
        id SERIAL PRIMARY KEY,
        survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL,
        prompt TEXT NOT NULL,
        recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
        options JSONB,
        required BOOLEAN NOT NULL DEFAULT TRUE,
        max INTEGER NOT NULL DEFAULT 5
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_survey_questions_survey ON survey_questions (survey_id)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS survey_responses (
        id SERIAL PRIMARY KEY,
        survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL,
        user_agent TEXT,
        skipped JSONB NOT NULL DEFAULT '[]'::jsonb,
        submitted_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Belt-and-braces for DBs that created the table before skips existed.
    await db.execute(sql`ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS skipped JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS ux_survey_responses_survey_client ON survey_responses (survey_id, client_id)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS survey_answers (
        id SERIAL PRIMARY KEY,
        response_id INTEGER NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
        value JSONB NOT NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_survey_answers_response ON survey_answers (response_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_survey_answers_question ON survey_answers (question_id)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS _migrations_done (key TEXT PRIMARY KEY, done_at TIMESTAMP DEFAULT NOW())`);
    await db.execute(sql`
      INSERT INTO _migrations_done (key)
      SELECT 'surveys_v1'
      WHERE NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'surveys_v1')
    `);

    // Base sub-recipe production completions — see
    // lib/db/migrations/0048_sub_recipe_completions.sql. The Bases & Sauces
    // station's base card (Tomato Base) previously tracked "done" only in
    // component state: a refresh lost it and it never counted toward prep
    // progress. One row per (plan, sub-recipe) marks that base production
    // as complete for the day, whether ticked directly or via the make flow.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sub_recipe_completions (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
        sub_recipe_id INTEGER NOT NULL REFERENCES sub_recipes(id) ON DELETE CASCADE,
        batches NUMERIC(10,2),
        user_id INTEGER REFERENCES app_users(id),
        completed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_sub_recipe_completion UNIQUE (plan_id, sub_recipe_id)
      )
    `);

    // Fridge products: recipes that get wrapped and held in the production
    // fridge (core calzones, test calzones, mac cheese) — as opposed to
    // frozen / F2F / clearance / Wonky lines. Drives the Create Plan
    // "additional chilled dispatches" suggestions and the fridge stock count.
    // One-time backfill: everything currently core-menu or mac cheese is a
    // fridge product; later unticks by an admin must stick, hence the marker.
    await db.execute(sql`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_fridge_product BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.execute(sql`
      INSERT INTO _migrations_done (key)
      SELECT 'fridge_product_backfill'
      WHERE NOT EXISTS (SELECT 1 FROM _migrations_done WHERE key = 'fridge_product_backfill')
    `);
    {
      const result = await db.execute<{ cnt: number }>(sql`SELECT count(*)::int as cnt FROM _migrations_done WHERE key = 'fridge_product_backfill' AND done_at > NOW() - INTERVAL '5 seconds'`);
      if (Number(result.rows[0]?.cnt) > 0) {
        await db.execute(sql`UPDATE recipes SET is_fridge_product = TRUE WHERE is_core_menu = TRUE OR category = 'Macaroni Cheese'`);
      }
    }

    // Recipe collections — named groups of recipes for one-click adding to a
    // production plan (e.g. "August Test Box"). Distinct from `collections`
    // (goods leaving the unit).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recipe_collections (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recipe_collection_items (
        id SERIAL PRIMARY KEY,
        collection_id INTEGER NOT NULL REFERENCES recipe_collections(id) ON DELETE CASCADE,
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_recipe_collection_items_collection ON recipe_collection_items (collection_id)`);

    // Queued test production — batches decided ahead of the plan existing,
    // so unusual ingredients can be ordered early. See schema/queued_production.ts.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS queued_production (
        id SERIAL PRIMARY KEY,
        production_date DATE NOT NULL,
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        batches INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        plan_id INTEGER REFERENCES production_plans(id) ON DELETE SET NULL,
        notes TEXT,
        created_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_queued_production_date ON queued_production (production_date)`);

    // Stock-gate holds — see lib/db/migrations/0049_stock_gate_holds.sql.
    // Products automatically held back from next-day delivery (Shopify tag
    // + Zapiet prep-time rule) when fridge-vs-despatch surplus runs low.
    // Rows double as the audit trail: released_at IS NULL = hold is live.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS stock_gate_holds (
        id SERIAL PRIMARY KEY,
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        recipe_name TEXT NOT NULL,
        tag TEXT NOT NULL,
        product_gid TEXT,
        product_title TEXT,
        shopify_variant_id TEXT,
        surplus_at_hold INTEGER NOT NULL,
        threshold_at_hold INTEGER NOT NULL,
        dry_run BOOLEAN NOT NULL DEFAULT FALSE,
        verify_status TEXT,
        verify_note TEXT,
        held_at TIMESTAMP NOT NULL DEFAULT NOW(),
        released_at TIMESTAMP,
        released_by TEXT,
        surplus_at_release INTEGER
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_stock_gate_holds_recipe ON stock_gate_holds (recipe_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ix_stock_gate_holds_held_at ON stock_gate_holds (held_at)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_gate_holds_active ON stock_gate_holds (recipe_id) WHERE released_at IS NULL`);
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at) VALUES
        ('stock_gate_enabled', 'false', NOW()),
        ('stock_gate_dry_run', 'true', NOW()),
        ('stock_gate_threshold_packs', '5', NOW()),
        ('stock_gate_release_packs', '10', NOW()),
        ('stock_gate_auto_release', 'true', NOW()),
        ('stock_gate_tag', 'low-stock-hold', NOW()),
        ('stock_gate_interval_minutes', '5', NOW()),
        ('stock_gate_zapiet_location_id', '270812', NOW())
      ON CONFLICT (key) DO NOTHING
    `);

    console.log("Startup migrations OK");
  } catch (err) {
    console.error("Startup migration failed (non-fatal):", err);
  }
}

/** Lazy backfill for recipe_shopify_mappings.shopify_sku. Runs in the
 *  background on every startup but is a no-op once every row has a
 *  SKU recorded, so it's cheap. Pulled out of runStartupMigrations
 *  because it hits Shopify and we don't want migration errors to
 *  cascade from network blips. */
async function backfillShopifyMappingSkus() {
  try {
    const rows = await db.execute<{ shopify_variant_id: string }>(sql`
      SELECT shopify_variant_id
      FROM recipe_shopify_mappings
      WHERE shopify_sku IS NULL AND shopify_variant_id IS NOT NULL
    `);
    const variantIds = (rows.rows ?? rows).map(r => r.shopify_variant_id).filter(Boolean);
    if (variantIds.length === 0) return;
    console.log(`[startup] backfilling shopify_sku for ${variantIds.length} mappings`);
    const { getVariantSkus } = await import("./services/shopify");
    const skuMap = await getVariantSkus(variantIds);
    for (const [vid, sku] of skuMap) {
      await db.execute(sql`UPDATE recipe_shopify_mappings SET shopify_sku = ${sku} WHERE shopify_variant_id = ${vid}`);
    }
    console.log(`[startup] populated shopify_sku for ${skuMap.size}/${variantIds.length} mappings`);
  } catch (err) {
    console.warn("[startup] shopify_sku backfill failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}

async function seedAdminIfNeeded() {
  try {
    const [{ value }] = await db.select({ value: count() }).from(usersTable);
    console.log(`Seed check: ${value} user(s) in database`);
    if (Number(value) === 0) {
      const tempPassword = "TCKAdmin2024!";
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      await db.insert(usersTable).values({
        name: "Admin",
        email: "admin@thecalzonekitchen.co.uk",
        passwordHash,
        role: "admin",
        isActive: true,
      });
      console.log("===========================================");
      console.log("No users found. Created default admin:");
      console.log("  Email:    admin@thecalzonekitchen.co.uk");
      console.log(`  Password: ${tempPassword}`);
      console.log("Change this password immediately after login.");
      console.log("===========================================");
    }
  } catch (err) {
    console.error("Seed check failed (non-fatal):", err);
  }
}

async function startup() {
  // Listen immediately so the deployment health-check can pass quickly,
  // then run migrations and seeding in the background.
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });

  try {
    await runStartupMigrations();
    await seedAdminIfNeeded();
    // Fire-and-forget — runs against Shopify, can take a while on a
    // cold cache, but the server doesn't need to wait for it.
    void backfillShopifyMappingSkus();
    const { guardMarinadeSettings } = await import("./lib/seed-guard");
    await guardMarinadeSettings();
    const { seedRiskAssessmentsIfNeeded } = await import("./lib/seed-risk-assessments");
    await seedRiskAssessmentsIfNeeded();
    const { seedLeanLessonsIfNeeded } = await import("./lib/seed-lean-lessons");
    await seedLeanLessonsIfNeeded();
    startBackupScheduler();
    // DISABLED 2026-04-17 — the 5-minute fulfilment poller was not
    // reliably decrementing fridge stock and contributed to Railway
    // OOMs when stacked with dashboard traffic. Replaced by the
    // manual "Process Fulfilled Today" button (see
    // routes/fulfilment.ts > POST /api/fulfilment/process-fulfilled-today).
    // The poller module is left on disk in case we want to revive it
    // later; just un-comment the two lines below.
    // const { startFulfilmentPoller } = await import("./lib/fulfilment-poller");
    // startFulfilmentPoller().catch(err => console.error("[fulfilment-poller] start failed:", err));

    // Govee temperature-sensor poller — self-gates on the runtime settings
    // (off unless the master switch + a feature is enabled), so it's a no-op
    // until configured. Lean: one Govee fetch per cycle.
    const { startGoveePoller } = await import("./lib/govee-poller");
    startGoveePoller();

    // Stock gate — holds products back from next-day delivery when the
    // fridge-vs-despatch surplus runs low. Self-gates on stock_gate_enabled
    // (default false) + dry-run, so it's a no-op until configured. One
    // calculate pass per cycle, same engine as the Create Plan screen.
    const { startStockGatePoller } = await import("./lib/stock-gating");
    startStockGatePoller();

    // System-updates feed for the morning-meeting slide. Computed once
    // per deploy (this boot) and refreshed on a slow timer, then written
    // to the DB so the slide is a pure DB read — no live git/GitHub call
    // on the render path (which silently rate-limited in production and
    // left the slide permanently empty). Fire-and-forget: the slide
    // self-heals on first view if this hasn't landed yet.
    const { refreshSystemUpdatesSnapshot } = await import("./routes/system-updates");
    void refreshSystemUpdatesSnapshot();
    setInterval(() => void refreshSystemUpdatesSnapshot(), 3 * 60 * 60_000).unref();
  } catch (err) {
    console.error(
      "Background startup tasks failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

startup();
