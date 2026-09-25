#!/usr/bin/env tsx
/**
 * backfill-build-times.ts
 *
 * One-time task: derive each recipe's expected build time per batch from what
 * ACTUALLY happened over the last N days of batch completions, and write it into
 * recipes.target_build_seconds. The production-schedule timeline reads that
 * value, so this seeds the schedule from reality instead of hand-entered guesses.
 *
 * Method: src/lib/timing-suggestions.ts (suggestBuildSeconds) — the SAME rules
 * the Recipes page "Timing data" card uses for its suggestions, so this script
 * and the app can never propose different numbers. In short: the gap between
 * consecutive completions in one (plan item, station) stream is one builder's
 * batch; gaps under 20 s, over 25 min, or containing a logged station break
 * are dropped, then anything over 3× the median, and the median of the rest
 * is the proposal.
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
import { BUILD_RULES, suggestBuildSeconds, type BuildCompletion, type StationBreakInterval } from "../src/lib/timing-suggestions";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DAYS = Number(args.find(a => a.startsWith("--days="))?.split("=")[1] ?? 30);
const MIN_SAMPLES = Number(args.find(a => a.startsWith("--min="))?.split("=")[1] ?? BUILD_RULES.minSamples);

async function main() {
  console.log(`\nBuild-time backfill — last ${DAYS} days, ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  // Pull building completions joined to recipe, plus the builders' logged breaks.
  const { rows } = await pool.query<{
    recipe_id: number;
    recipe_name: string;
    plan_id: number;
    plan_item_id: number;
    station_type: string;
    completed_at: string;
    current_target: number | null;
  }>(`
    SELECT r.id AS recipe_id, r.name AS recipe_name,
           pi.plan_id, bc.plan_item_id, bc.station_type, bc.completed_at,
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
  `, [DAYS]);
  const { rows: breakRows } = await pool.query<{ plan_id: number; station_type: string; started_at: string; ended_at: string | null }>(`
    SELECT plan_id, station_type, started_at, ended_at
    FROM station_breaks
    WHERE station_type IN ('building_1', 'building_2')
      AND started_at >= NOW() - (($1::int + 1) || ' days')::interval
  `, [DAYS]);

  const recipeName = new Map<number, string>();
  const currentTarget = new Map<number, number | null>();
  const completions: BuildCompletion[] = rows.map(row => {
    recipeName.set(row.recipe_id, row.recipe_name);
    currentTarget.set(row.recipe_id, row.current_target);
    return {
      recipeId: row.recipe_id,
      planId: row.plan_id,
      planItemId: row.plan_item_id,
      stationType: row.station_type,
      completedAtMs: new Date(row.completed_at).getTime(),
    };
  });
  const breaks: StationBreakInterval[] = breakRows.map(b => ({
    planId: b.plan_id,
    stationType: b.station_type,
    startMs: new Date(b.started_at).getTime(),
    endMs: b.ended_at ? new Date(b.ended_at).getTime() : null,
  }));

  const suggestions = suggestBuildSeconds(completions, breaks, { ...BUILD_RULES, minSamples: MIN_SAMPLES });
  const proposals: { recipeId: number; name: string; samples: number; medianMin: number; seconds: number; current: number | null }[] = [];
  for (const [recipeId, s] of suggestions) {
    proposals.push({
      recipeId,
      name: recipeName.get(recipeId) ?? `#${recipeId}`,
      samples: s.samples,
      medianMin: Math.round((s.value / 60) * 10) / 10,
      seconds: s.value,
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
