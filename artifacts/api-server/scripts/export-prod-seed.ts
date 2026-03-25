#!/usr/bin/env tsx
/**
 * export-prod-seed.ts
 *
 * Exports seed/config reference data from the current DATABASE_URL into a SQL
 * file that can be applied to a fresh production database.
 *
 * Run:
 *   pnpm --filter @workspace/api-server run export-seed
 *
 * Output:
 *   artifacts/api-server/scripts/prod-seed.sql
 *
 * The generated file:
 *   1. Disables FK triggers on all seed tables (ALTER TABLE … DISABLE TRIGGER ALL)
 *   2. TRUNCATEs seed tables with CASCADE to clear any dependent non-seed tables
 *   3. INSERTs data in FK-safe forward order using explicit IDs
 *   4. Resets every serial sequence to max(id) + 1 via setval()
 *   5. Re-enables FK triggers on all seed tables (ALTER TABLE … ENABLE TRIGGER ALL)
 */

import { pool } from "@workspace/db";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, "prod-seed.sql");

// ── Seed tables (reverse FK order — most-dependent first) ───────────────────
const SEED_TABLES_REVERSE: string[] = [
  "ingredient_storage_locations",
  "kanban_items",
  "delivery_check_configs",
  "dpt_settings",
  "sub_recipe_sub_recipes",
  "sub_recipe_ingredients",
  "recipe_shopify_mappings",
  "recipe_meat_marinades",
  "recipe_sub_recipes",
  "recipe_ingredients",
  "stock_items",
  "storage_racks",
  "recipes",
  "sub_recipes",
  "ingredients",
  "sku_locations",
  "postcode_validations",
  "page_permissions",
  "app_settings",
  "timing_standards",
  "category_defaults",
  "stock_item_categories",
  "storage_locations",
  "suppliers",
];

// Tables with a serial integer PK named "id" — need explicit sequence resets.
const SERIAL_ID_TABLES: string[] = [
  "suppliers",
  "storage_locations",
  "stock_item_categories",
  "category_defaults",
  "timing_standards",
  "app_settings",
  "ingredients",
  "sub_recipes",
  "recipes",
  "storage_racks",
  "stock_items",
  "recipe_ingredients",
  "recipe_sub_recipes",
  "recipe_meat_marinades",
  "recipe_shopify_mappings",
  "sub_recipe_ingredients",
  "sub_recipe_sub_recipes",
  "dpt_settings",
  "delivery_check_configs",
  "kanban_items",
  "ingredient_storage_locations",
  "postcode_validations",
  // page_permissions  — text PK (page_key), no serial id
  // sku_locations     — text PK (sku),       no serial id
];

// ── Per-table column overrides ───────────────────────────────────────────────
// ingredient_storage_locations has NO quantity or amount columns per schema:
//   id, ingredient_id, location_id, rack_label, shelf_label
// Selecting columns explicitly (rather than SELECT *) documents intent clearly.
const COLUMN_OVERRIDES: Record<string, string> = {
  ingredient_storage_locations:
    "id, ingredient_id, location_id, rack_label, shelf_label",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function sqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  if (val instanceof Date) {
    return `'${val.toISOString().replace("T", " ").replace("Z", "")}'`;
  }
  const s = String(val);
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function buildInsert(tableName: string, rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return `-- ${tableName}: no rows\n`;
  const cols = Object.keys(rows[0]);
  const valueRows = rows
    .map(r => `  (${cols.map(c => sqlLiteral(r[c])).join(", ")})`)
    .join(",\n");
  return `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES\n${valueRows};\n`;
}

async function queryTable(
  tableName: string,
  orderBy: string,
  selectCols = "*",
): Promise<Record<string, unknown>[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT ${selectCols} FROM ${tableName} ORDER BY ${orderBy}`,
    );
    return result.rows as Record<string, unknown>[];
  } finally {
    client.release();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const lines: string[] = [
    "-- ============================================================",
    "-- TCK Production Seed",
    `-- Generated: ${new Date().toISOString()}`,
    "--",
    "-- !! WARNING: For a FRESHLY-PROVISIONED production database only !!",
    "-- TRUNCATE … CASCADE also clears dependent tables such as:",
    "-- production_plan_items, prep_completions, batch_completions,",
    "-- daily_stock_checks, temperature_records, oven_events, etc.",
    "-- Do NOT run against a database with live operational data.",
    "--",
    "-- Apply via psql:",
    '--   psql "$PRODUCTION_DATABASE_URL" < prod-seed.sql',
    "--",
    "-- Or POST to /api/admin/apply-seed (see MIGRATION.md).",
    "-- ============================================================",
    "",
  ];

  // ── Step 1: TRUNCATE with CASCADE ─────────────────────────────────────────
  lines.push("-- ── Step 1: clear seed tables (CASCADE clears FK-dependent tables) ──");
  lines.push("TRUNCATE TABLE");
  lines.push("  " + SEED_TABLES_REVERSE.join(",\n  "));
  lines.push("CASCADE;");
  lines.push("");

  // ── Step 2: INSERT in FK-safe forward order ────────────────────────────────
  lines.push("-- ── Step 2: insert seed data (FK-safe order) ──────────────────");
  lines.push("");

  const insertOrder: Array<[string, string]> = [
    ["suppliers",                    "id"],
    ["storage_locations",            "id"],
    ["stock_item_categories",        "name"],
    ["category_defaults",            "id"],
    ["timing_standards",             "id"],
    ["app_settings",                 "key"],
    ["page_permissions",             "page_key"],
    ["postcode_validations",         "shopify_order_id, service_code"],
    ["sku_locations",                "sku"],
    // Depend on suppliers
    ["ingredients",                  "id"],
    ["stock_items",                  "id"],
    ["delivery_check_configs",       "id"],
    // No FK in table itself
    ["sub_recipes",                  "id"],
    ["recipes",                      "id"],
    // Depends on storage_locations
    ["storage_racks",                "id"],
    // Junction / child tables
    ["recipe_ingredients",           "id"],
    ["recipe_sub_recipes",           "id"],
    ["recipe_meat_marinades",        "id"],
    ["recipe_shopify_mappings",      "id"],
    ["sub_recipe_ingredients",       "id"],
    ["sub_recipe_sub_recipes",       "id"],
    ["dpt_settings",                 "id"],
    ["kanban_items",                 "id"],
    // ingredient_storage_locations schema: id, ingredient_id, location_id,
    // rack_label, shelf_label.  No quantity or amount columns exist in this
    // table; selecting explicit columns documents this clearly.
    ["ingredient_storage_locations", "id"],
  ];

  for (const [tableName, orderBy] of insertOrder) {
    console.log(`  Exporting ${tableName}...`);
    const selectCols = COLUMN_OVERRIDES[tableName] ?? "*";
    const rows = await queryTable(tableName, orderBy, selectCols);
    lines.push(`-- TABLE: ${tableName} (${rows.length} rows)`);
    lines.push(buildInsert(tableName, rows));
    lines.push("");
  }

  // ── Step 3: reset sequences to max(id) + 1 ────────────────────────────────
  lines.push("-- ── Step 3: reset sequences to max(id) + 1 ────────────────────");
  for (const tbl of SERIAL_ID_TABLES) {
    lines.push(
      `SELECT setval(pg_get_serial_sequence('${tbl}', 'id'),` +
      ` COALESCE((SELECT MAX(id) FROM ${tbl}), 0) + 1, false);`,
    );
  }
  lines.push("");


  const content = lines.join("\n");
  writeFileSync(OUTPUT, content, "utf-8");
  console.log(`\nWrote ${OUTPUT}`);
  console.log(`  ${content.split("\n").length} lines, ${content.length} bytes`);

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error(
    "Export failed:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
