#!/usr/bin/env tsx
/**
 * backfill-build-times.ts
 *
 * One-time task: derive each recipe's expected build time per batch from what
 * ACTUALLY happened over the last N days of batch completions, and write it into
 * recipes.target_build_seconds. The production-schedule timeline reads that
 * value, so this seeds the schedule from reality instead of hand-entered guesses.
 *
 * Method (kept deliberately simple):
 *   - Look at every building-station completion (building_1 / building_2) in the
 *     window, grouped by (plan item, station) and ordered by time.
 *   - The gap between two consecutive completions in the same stream is how long
 *     that one batch took for one builder.
 *   - Drop gaps that aren't real build time: <= 0, or longer than MAX_GAP_MIN
 *     (those span breaks, changeovers, or the end of a recipe run).
 *   - Per recipe, take the MEDIAN of the remaining gaps (robust to outliers).
 *   - Proposed target_build_seconds = round(median minutes × 60).
 *
 * This is a SINGLE-BUILDER pace, which is exactly what the schedule wants — it
 * divides by the builder count itself.
 *
 * Run (DRY RUN — prints proposed values, writes nothing):
 *   DATABASE_URL=... pnpm --filter @workspace/api-server exec tsx scripts/backfill-build-times.ts
 *
 * Apply for real (writes recipes.target_build_seconds):
 *   DATABASE_URL=... pnpm --filter @workspace/api-server exec tsx scripts/backfill-build-times.ts --apply
 *
 * Options:
 *   --days=N     window size in days (default 30)
 *   --apply      actually write; without it, dry run only
 *   --min=N      ignore recipes with fewer than N usable batch gaps (default 5)
 */

import { pool } from "@workspace/db";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DAYS = Number(args.find(a => a.startsWith("--days="))?.split("=")[1] ?? 30);
const MIN_SAMPLES = Number(args.find(a => a.startsWith("--min="))?.split("=")[1] ?? 5);
const MAX_GAP_MIN = 25; // gaps longer than this aren't a single batch
const MIN_GAP_SEC = 20; // gaps shorter than this are double-taps / errors

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function main() {
  console.log(`\nBuild-time backfill — last ${DAYS} days, ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  // Pull building completions joined to recipe, ordered for gap analysis.
  const { rows } = await pool.query<{
    recipe_id: number;
    recipe_name: string;
    plan_item_id: number;
    station_type: string;
    completed_at: string;
    current_target: number | null;
  }>(`
    SELECT r.id AS recipe_id, r.name AS recipe_name,
           bc.plan_item_id, bc.station_type, bc.completed_at,
           r.target_build_seconds AS current_target
    FROM batch_completions bc
    JOIN production_plan_items pi ON pi.id = bc.plan_item_id
    JOIN recipes r ON r.id = pi.recipe_id
    WHERE bc.station_type IN ('building_1', 'building_2')
      AND bc.completed_at >= NOW() - ($1 || ' days')::interval
      AND bc.correction_by_user_id IS NULL
      -- Mac cheese "completions" are blast-tray pack logs, not builds — their
      -- gaps say nothing about build pace, and the day schedule excludes the
      -- category anyway.
      AND r.category IS DISTINCT FROM 'Macaroni Cheese'
    ORDER BY bc.plan_item_id, bc.station_type, bc.completed_at
  `, [DAYS]);

  // Walk each (plan item, station) stream, collecting per-batch gaps by recipe.
  const gapsByRecipe = new Map<number, number[]>();
  const recipeName = new Map<number, string>();
  const currentTarget = new Map<number, number | null>();

  let prevKey = "";
  let prevTime = 0;
  for (const row of rows) {
    recipeName.set(row.recipe_id, row.recipe_name);
    currentTarget.set(row.recipe_id, row.current_target);
    const key = `${row.plan_item_id}:${row.station_type}`;
    const t = new Date(row.completed_at).getTime();
    if (key === prevKey) {
      const gapMin = (t - prevTime) / 60000;
      if (gapMin * 60 >= MIN_GAP_SEC && gapMin <= MAX_GAP_MIN) {
        const list = gapsByRecipe.get(row.recipe_id) ?? [];
        list.push(gapMin);
        gapsByRecipe.set(row.recipe_id, list);
      }
    }
    prevKey = key;
    prevTime = t;
  }

  const proposals: { recipeId: number; name: string; samples: number; medianMin: number; seconds: number; current: number | null }[] = [];
  for (const [recipeId, gaps] of gapsByRecipe) {
    if (gaps.length < MIN_SAMPLES) continue;
    const medMin = median(gaps);
    proposals.push({
      recipeId,
      name: recipeName.get(recipeId) ?? `#${recipeId}`,
      samples: gaps.length,
      medianMin: Math.round(medMin * 10) / 10,
      seconds: Math.round(medMin * 60),
      current: currentTarget.get(recipeId) ?? null,
    });
  }
  proposals.sort((a, b) => a.name.localeCompare(b.name));

  if (proposals.length === 0) {
    console.log("No recipes had enough usable batch gaps in the window. Nothing to propose.\n");
    await pool.end();
    return;
  }

  console.log("Recipe".padEnd(34), "Samples".padStart(8), "Median/batch".padStart(14), "→ seconds".padStart(11), "Current".padStart(9));
  console.log("-".repeat(80));
  for (const p of proposals) {
    const cur = p.current == null ? "—" : `${p.current}s`;
    console.log(
      p.name.slice(0, 33).padEnd(34),
      String(p.samples).padStart(8),
      `${p.medianMin} min`.padStart(14),
      `${p.seconds}s`.padStart(11),
      cur.padStart(9),
    );
  }
  console.log("-".repeat(80));
  console.log(`${proposals.length} recipes with ≥${MIN_SAMPLES} samples.\n`);

  if (!APPLY) {
    console.log("DRY RUN — nothing written. Re-run with --apply to save these into recipes.target_build_seconds.\n");
    await pool.end();
    return;
  }

  let written = 0;
  for (const p of proposals) {
    await pool.query(`UPDATE recipes SET target_build_seconds = $1 WHERE id = $2`, [p.seconds, p.recipeId]);
    written += 1;
  }
  console.log(`Applied: updated target_build_seconds on ${written} recipes.\n`);
  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
