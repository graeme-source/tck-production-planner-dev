#!/usr/bin/env tsx
/**
 * quid-backfill.ts — Automatic QUID over every non-archived recipe
 * (Graeme, 2026-10-10). Same code as POST /api/quid-backfill and as every
 * recipe save (lib/quid-store.ts): lines the recipe's name names are ticked
 * QUID (auto); lines that were ticked automatically and no longer match are
 * unticked; anything a person ticked or unticked is left alone. Questions
 * ("Should 'BBQ' show a percentage?") are listed, never answered here —
 * they're answered in the recipe's QUID panel.
 *
 * Dry run (default — prints what would change and the deck it would give,
 * writes nothing):
 *   cd artifacts/api-server
 *   node --env-file=.env --import tsx/esm scripts/quid-backfill.ts
 *
 * Apply (writes OUR database only — nothing goes to Shopify; every changed
 * deck then shows "Label update needed" on the Labels page):
 *   node --env-file=.env --import tsx/esm scripts/quid-backfill.ts --apply
 *
 * Add --json for the full report as JSON.
 */
import { pool } from "@workspace/db";
import { formatBackfill, quidBackfill } from "../src/lib/quid-store";

async function main() {
  const apply = process.argv.includes("--apply");
  const json = process.argv.includes("--json");
  const report = await quidBackfill({ apply, actorName: "QUID backfill script" });
  console.log(json ? JSON.stringify(report, null, 2) : formatBackfill(report));
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
