#!/usr/bin/env tsx
/**
 * pull-barcodes.ts — the one-time barcode pull (Graeme, 2026-10-10).
 *
 * READS every Shopify variant and fills OUR barcode table (sku_barcodes) for
 * every variant linked to a recipe — 2-packs, 8-pack bags, wonky packs.
 * Nothing is ever written to Shopify. Same code as the "Pull barcodes from
 * Shopify" button on the Barcodes page (lib/barcode-store.ts).
 *
 * Never overwrites a barcode we already hold: a difference is listed as a
 * conflict. Retired products (Shopify product not active and not linked to
 * an active recipe) never claim a barcode. After the run, clashes between
 * current products and retired products still holding reused codes are
 * listed.
 *
 * Dry run (default — prints what would change, writes nothing):
 *   cd artifacts/api-server
 *   node --env-file=.env --import tsx/esm scripts/pull-barcodes.ts
 *
 * Apply (writes OUR database only):
 *   node --env-file=.env --import tsx/esm scripts/pull-barcodes.ts --apply
 *
 * Add --json for the full report as JSON.
 */
import { pool } from "@workspace/db";
import { reconcileBarcodes } from "../src/lib/barcode-store";

async function main() {
  const apply = process.argv.includes("--apply");
  const json = process.argv.includes("--json");
  const r = await reconcileBarcodes({ mode: "pull", dryRun: !apply, actor: { id: null, name: "pull-barcodes script" } });
  if (json) { console.log(JSON.stringify(r, null, 2)); return; }

  console.log(`\nBarcode pull — ${apply ? "APPLIED to our database" : "DRY RUN (nothing written)"} — ${r.at}`);
  console.log(`Linked variants: ${r.linkedVariants}`);
  const c = r.counts;
  console.log(`  filled ${c.filled} · unchanged ${c.unchanged} · conflict ${c.conflict} · missing in Shopify ${c.missing} · not in Shopify ${c.notInShopify} · retired ${c.retired} · invalid ${c.invalid}`);
  console.log(`Unlinked variants following Shopify: ${r.followed}; retired variants no longer claiming a code: ${r.retiredCleared}`);

  const show = (title: string, items: typeof r.items) => {
    if (!items.length) return;
    console.log(`\n${title}`);
    for (const i of items) console.log(`  ${i.recipeName} [${i.kind}] ${i.name} (${i.variantId}): ours ${i.ours ?? "—"} · Shopify ${i.shopify ?? "—"}${i.invalid ? ` · INVALID ${i.invalid}` : ""}`);
  };
  show("Filled:", r.items.filter(i => i.outcome === "filled"));
  show("Conflicts (ours kept, listed):", r.items.filter(i => i.outcome === "conflict"));
  show("Missing in Shopify:", r.items.filter(i => i.outcome === "missing"));
  show("Not in Shopify any more:", r.items.filter(i => i.outcome === "not-in-shopify"));
  show("Retired (linked, but recipe and Shopify product both inactive):", r.items.filter(i => i.outcome === "retired"));
  show("Invalid check digit (stored, flagged):", r.items.filter(i => i.invalid));

  if (r.clashes.length) {
    console.log("\nCurrent products sharing a code (a decision is needed):");
    for (const k of r.clashes) console.log(`  ${k.message}`);
  }
  if (r.reused.length) {
    console.log("\nRetired products still holding a reused code (optional tidy in Shopify):");
    for (const u of r.reused) console.log(`  ${u.barcode}: used by ${u.current?.identity.name ?? "—"}; also on ${u.retired.map(x => x.name).join(", ")}`);
  }
  if (r.ambiguousBags.length) console.log(`\nBags not linked (their product holds two recipes' packs): ${r.ambiguousBags.map(b => b.name).join(", ")}`);
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
