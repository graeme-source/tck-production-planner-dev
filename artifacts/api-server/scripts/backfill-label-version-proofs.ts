#!/usr/bin/env tsx
/**
 * backfill-label-version-proofs.ts — Objective D (traceable, lawful labels).
 *
 * Label versions published before migration 0172 have no stored picture
 * (product_label_versions.proof_png is NULL), so the label history re-draws
 * them from their saved snapshot with whatever layout code is running. This
 * fills proof_png / proof_dpi for those versions ONCE, using the CURRENT
 * code — the same proofLabel → bitmap path the publish route and the
 * back-label print route use — dated the day each version was published
 * (London).
 *
 * That is only a faithful record while the layout code is still the one those
 * versions were printed with: RUN IT ON LIVE BEFORE ANY LAYOUT CHANGE DEPLOYS.
 *
 * Idempotent: only rows with proof_png IS NULL are touched, and each update
 * re-checks that, so running it twice (or alongside a publish) changes
 * nothing that is already stored.
 *
 * Dry run (default — renders and reports, writes nothing):
 *   DATABASE_URL=... pnpm --filter @workspace/api-server exec tsx scripts/backfill-label-version-proofs.ts
 *   (or with --dry-run, same thing)
 * Apply:
 *   DATABASE_URL=... pnpm --filter @workspace/api-server exec tsx scripts/backfill-label-version-proofs.ts --apply
 */
import { pool } from "@workspace/db";
import type { LabelSnapshot } from "@workspace/product-labels";
import { encodePng, proofLabel } from "@workspace/product-labels/render";
import { loadBundledFonts } from "@workspace/product-labels/node";
import { londonDateString } from "../src/lib/london-time";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
if (APPLY && args.includes("--dry-run")) {
  console.error("Pass --apply OR --dry-run, not both.");
  process.exit(2);
}

async function main() {
  console.log(`\nLabel version proof backfill — ${APPLY ? "APPLY" : "DRY RUN (nothing written; pass --apply to write)"}\n`);
  const { rows } = await pool.query<{
    id: number; recipe_name: string; version_no: number; snapshot: LabelSnapshot; published_at: Date;
  }>(
    `SELECT id, recipe_name, version_no, snapshot, published_at
       FROM product_label_versions
      WHERE proof_png IS NULL
      ORDER BY recipe_name, version_no`,
  );
  if (rows.length === 0) {
    console.log("Every label version already has its stored picture — nothing to do.");
    return;
  }
  const fonts = loadBundledFonts();
  let written = 0, failed = 0;
  for (const r of rows) {
    const day = londonDateString(r.published_at);
    try {
      const proof = proofLabel(r.snapshot, { printDate: day, productionDate: day }, fonts);
      const png = Buffer.from(encodePng(proof.bitmap));
      const dpi = proof.layout.dpi;
      const fit = proof.layout.fits ? "fits" : "DOESN'T FIT (stored as drawn)";
      if (APPLY) {
        const u = await pool.query(
          "UPDATE product_label_versions SET proof_png = $2, proof_dpi = $3 WHERE id = $1 AND proof_png IS NULL",
          [r.id, png, dpi],
        );
        written += u.rowCount ?? 0;
        console.log(`  ${u.rowCount ? "stored " : "skipped"}  ${r.recipe_name} v${r.version_no} (published ${day}) — ${proof.bitmap.width}×${proof.bitmap.height} @ ${dpi} dpi, ${Math.round(png.length / 1024)} KB, ${fit}`);
      } else {
        console.log(`  would store  ${r.recipe_name} v${r.version_no} (published ${day}) — ${proof.bitmap.width}×${proof.bitmap.height} @ ${dpi} dpi, ${Math.round(png.length / 1024)} KB, ${fit}`);
      }
    } catch (err) {
      failed++;
      console.error(`  FAILED  ${r.recipe_name} v${r.version_no}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`\n${rows.length} version(s) without a picture; ${APPLY ? `${written} stored` : "dry run, none written"}${failed ? `; ${failed} failed` : ""}.`);
  if (failed) process.exitCode = 1;
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
