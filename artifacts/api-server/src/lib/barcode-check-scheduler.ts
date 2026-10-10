/**
 * Hourly barcode check (Graeme, 2026-10-10) — replaces the manual "Sync from
 * Shopify" that had to be pressed after every barcode change.
 *
 * READ-ONLY towards Shopify. Each run records what Shopify has for every
 * variant (shown as "Different in Shopify" where it isn't ours — never
 * applied to a recipe's barcode without a person's "Use Shopify's"), keeps
 * unlinked products' barcodes, titles and images in step, and stops retired
 * products claiming codes. Same rule as the Bin Locations "Check Shopify
 * now" button: lib/barcode-store.ts reconcileBarcodes(mode "check").
 * It stays idle until the one-time pull has been run for real.
 */
const INTERVAL_MS = 60 * 60 * 1000;
const FIRST_RUN_MS = 2 * 60 * 1000;

async function run(): Promise<void> {
  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    // First boot before migration 0161 has run — try again next hour.
    const guard = await db.execute<{ ok: string | null }>(sql`SELECT to_regclass('public.barcode_events')::text AS ok`);
    if (!guard.rows[0]?.ok) return;
    const { reconcileBarcodes, firstPullAt } = await import("./barcode-store");
    // Nothing runs until Graeme's one-time pull has (POST /api/barcodes/pull,
    // the Barcodes page button, or scripts/pull-barcodes.ts --apply).
    if (!(await firstPullAt())) return;
    const r = await reconcileBarcodes({ mode: "check", dryRun: false, actor: null });
    console.log(`[barcodes] hourly check: ${r.linkedVariants} linked variants; different in Shopify ${r.counts.conflict + r.counts.shopifyOnly}; followed ${r.followed}; clashes ${r.clashes.length}; retired cleared ${r.retiredCleared}`);
  } catch (err) {
    console.error("[barcodes] hourly check failed:", err instanceof Error ? err.message : err);
  }
}

export function startBarcodeCheckScheduler(): void {
  setTimeout(() => void run(), FIRST_RUN_MS).unref();
  setInterval(() => void run(), INTERVAL_MS).unref();
}
