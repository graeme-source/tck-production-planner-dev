import app from "./app";
import { db, usersTable } from "@workspace/db";
import { sql, count } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { startBackupScheduler, runBackup } from "./lib/backup";

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
  const SYSTEM_LOCATIONS = [
    { name: "Prep Fridge", zone: "fridge" },
    { name: "Raw Meat Fridge", zone: "fridge" },
    { name: "Raw Freezer", zone: "freezer" },
    { name: "Production Fridge", zone: "fridge" },
    { name: "Production Freezer", zone: "freezer" },
    { name: "Dry Store", zone: "ambient" },
  ];
  for (const loc of SYSTEM_LOCATIONS) {
    await db.execute(sql`
      INSERT INTO storage_locations (name, zone, is_system)
      SELECT ${loc.name}, ${loc.zone}, TRUE
      WHERE NOT EXISTS (SELECT 1 FROM storage_locations WHERE name = ${loc.name})
    `);
  }
}

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
    await db.execute(sql`
      ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_current_special BOOLEAN NOT NULL DEFAULT FALSE
    `);
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
    await db.execute(sql`
      ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS short_count INTEGER NOT NULL DEFAULT 0
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
    // Per-recipe build-time target in seconds, nullable. Drives the
    // countdown timer inside the BATCH BUILT button on the building
    // station. Null = fall back to building_timer_default_seconds app
    // setting (default 480s = 8 minutes).
    await db.execute(sql`
      ALTER TABLE recipes ADD COLUMN IF NOT EXISTS target_build_seconds INTEGER
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
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_prep_completion_v3
      ON prep_completions (plan_id, ingredient_id, recipe_id, tin_number)
    `);
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
    // The old single-image `standards_sops` table (image_url column) is
    // dropped on first run after this deploy since no records survived the
    // object-storage misconfiguration. From here on, images live as BYTEA
    // on sop_steps so everything works local + prod with no external deps.
    await db.execute(sql`DROP TABLE IF EXISTS standards_sops CASCADE`);
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
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_prep_completion_ing
      ON prep_completions (plan_id, ingredient_id, recipe_id, tin_number)
      WHERE ingredient_id IS NOT NULL
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_prep_completion_sub
      ON prep_completions (plan_id, sub_recipe_id, recipe_id, tin_number)
      WHERE sub_recipe_id IS NOT NULL
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

    // Leftover filling weight tracking
    await db.execute(sql`ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS leftover_filling_grams INTEGER`);
    await db.execute(sql`ALTER TABLE production_plan_items ADD COLUMN IF NOT EXISTS leftover_filling_comment TEXT`);

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

    console.log("Startup migrations OK");
  } catch (err) {
    console.error("Startup migration failed (non-fatal):", err);
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
    const { guardMarinadeSettings } = await import("./lib/seed-guard");
    await guardMarinadeSettings();
    const { seedRiskAssessmentsIfNeeded } = await import("./lib/seed-risk-assessments");
    await seedRiskAssessmentsIfNeeded();
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
  } catch (err) {
    console.error(
      "Background startup tasks failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

startup();
