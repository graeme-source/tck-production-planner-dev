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
 */

import { pool } from "@workspace/db";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, "prod-seed.sql");

function sqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  if (val instanceof Date) return `'${val.toISOString().replace("T", " ").replace("Z", "")}'`;
  const s = String(val);
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function buildUpsertBlock(
  tableName: string,
  conflictCols: string[],
  rows: Record<string, unknown>[],
): string {
  if (rows.length === 0) return `-- ${tableName}: no rows\n\n`;
  const cols = Object.keys(rows[0]);
  const updateCols = cols.filter(c => !conflictCols.includes(c));
  const updateClause =
    updateCols.length > 0
      ? `DO UPDATE SET ${updateCols.map(c => `${c}=EXCLUDED.${c}`).join(", ")}`
      : "DO NOTHING";

  const valueRows = rows
    .map(r => `  (${cols.map(c => sqlLiteral(r[c])).join(", ")})`)
    .join(",\n");

  return (
    `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES\n` +
    `${valueRows}\n` +
    `ON CONFLICT (${conflictCols.join(", ")}) ${updateClause};\n\n`
  );
}

async function queryTable(tableName: string, orderBy: string): Promise<Record<string, unknown>[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT * FROM ${tableName} ORDER BY ${orderBy}`);
    return result.rows as Record<string, unknown>[];
  } finally {
    client.release();
  }
}

async function main() {
  const lines: string[] = [
    "-- ============================================================",
    "-- TCK Production Seed",
    `-- Generated: ${new Date().toISOString()}`,
    "--",
    "-- Apply via psql:",
    "--   psql $PRODUCTION_DATABASE_URL < prod-seed.sql",
    "--",
    "-- Or POST via admin API:",
    "--   curl -X POST https://YOUR_API/api/admin/apply-seed \\",
    "--        -H 'Content-Type: text/plain' \\",
    "--        --data-binary @scripts/prod-seed.sql",
    "--        (requires admin session cookie)",
    "-- ============================================================",
    "",
    "BEGIN;",
    "",
  ];

  const dump = async (tableName: string, conflictCols: string[], orderBy: string) => {
    console.log(`  Exporting ${tableName}...`);
    const rows = await queryTable(tableName, orderBy);
    lines.push(`-- TABLE: ${tableName} (${rows.length} rows)`);
    lines.push(buildUpsertBlock(tableName, conflictCols, rows));
  };

  console.log("Exporting seed tables...");

  // ── FK-safe insertion order ─────────────────────────────────────────────────
  // No FK deps
  await dump("suppliers",             ["id"],                    "id");
  await dump("storage_locations",     ["id"],                    "id");
  await dump("stock_item_categories", ["name"],                  "name");
  await dump("category_defaults",     ["id"],                    "id");
  await dump("timing_standards",      ["id"],                    "id");
  await dump("app_settings",          ["key"],                   "key");
  await dump("page_permissions",      ["page_key"],              "page_key");
  await dump("postcode_validations",  ["shopify_order_id", "service_code"], "shopify_order_id, service_code");
  await dump("sku_locations",         ["sku"],                   "sku");

  // Depend on suppliers
  await dump("ingredients",           ["id"],                    "id");
  await dump("stock_items",           ["id"],                    "id");
  await dump("delivery_check_configs",["id"],                    "id");

  // No FK in table itself
  await dump("sub_recipes",           ["id"],                    "id");
  await dump("recipes",               ["id"],                    "id");

  // Depend on storage_locations
  await dump("storage_racks",         ["id"],                    "id");

  // Depend on recipes / ingredients / sub_recipes
  await dump("recipe_ingredients",        ["id"], "id");
  await dump("recipe_sub_recipes",        ["id"], "id");
  await dump("recipe_meat_marinades",     ["id"], "id");
  await dump("recipe_shopify_mappings",   ["id"], "id");
  await dump("sub_recipe_ingredients",    ["id"], "id");
  await dump("sub_recipe_sub_recipes",    ["id"], "id");
  await dump("dpt_settings",             ["id"], "id");

  // Depend on ingredients + storage_locations / suppliers
  await dump("kanban_items",              ["id"], "id");
  await dump("ingredient_storage_locations", ["id"], "id");

  // ── Sequence reset — ensures new rows don't collide with seeded IDs ─────────
  const serialTables: Array<[string, string]> = [
    ["suppliers",                      "id"],
    ["storage_locations",              "id"],
    ["category_defaults",              "id"],
    ["timing_standards",               "id"],
    ["ingredients",                    "id"],
    ["sub_recipes",                    "id"],
    ["recipes",                        "id"],
    ["storage_racks",                  "id"],
    ["stock_items",                    "id"],
    ["recipe_ingredients",             "id"],
    ["recipe_sub_recipes",             "id"],
    ["recipe_meat_marinades",          "id"],
    ["recipe_shopify_mappings",        "id"],
    ["sub_recipe_ingredients",         "id"],
    ["sub_recipe_sub_recipes",         "id"],
    ["dpt_settings",                   "id"],
    ["delivery_check_configs",         "id"],
    ["kanban_items",                   "id"],
    ["ingredient_storage_locations",   "id"],
    ["postcode_validations",           "id"],
  ];

  lines.push("-- ── Sequence resets ──────────────────────────────────────────────");
  for (const [t, col] of serialTables) {
    lines.push(
      `SELECT setval(pg_get_serial_sequence('${t}', '${col}'), ` +
      `COALESCE((SELECT MAX(${col}) FROM ${t}), 0) + 1, false);`,
    );
  }
  lines.push("");

  lines.push("COMMIT;");
  lines.push("");

  const content = lines.join("\n");
  writeFileSync(OUTPUT, content, "utf-8");
  console.log(`\nWrote ${OUTPUT}`);
  console.log(`  ${content.split("\n").length} lines, ${content.length} bytes`);

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error("Export failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
