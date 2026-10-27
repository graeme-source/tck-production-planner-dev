/**
 * Hourly barcode check (Graeme, 2026-10-10) — replaces the manual "Sync from
 * Shopify" that had to be pressed after every barcode change.
 *
 * Each run records what Shopify has for every variant (shown as "Different
 * in Shopify" where it isn't ours — never applied over a barcode we hold
 * without a person's "Use Shopify's"), ADOPTS Shopify's where we have none
 * (12 Oct 2026), applies barcodes held for recipes whose listing has since
 * been linked, keeps unlinked products' barcodes, titles and images in step,
 * and stops retired products claiming codes. Same rule as the Bin Locations
 * "Check Shopify now" button: lib/barcode-store.ts reconcileBarcodes(mode
 * "check"). Then it retries sends to Shopify left "waiting" — only once
 * writes are allowed (lib/barcode-push.ts).
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
    const { reconcileBarcodes, firstPullAt, retryWaitingPushes } = await import("./barcode-store");
    // Nothing runs until Graeme's one-time pull has (POST /api/barcodes/pull,
    // the Barcodes page button, or scripts/pull-barcodes.ts --apply).
    if (!(await firstPullAt())) return;
    const r = await reconcileBarcodes({ mode: "check", dryRun: false, actor: null });
    console.log(`[barcodes] hourly check: ${r.linkedVariants} linked variants; adopted ${r.counts.filled}; different in Shopify ${r.counts.conflict + r.counts.shopifyOnly}; followed ${r.followed}; clashes ${r.clashes.length}; retired cleared ${r.retiredCleared}`);
    // Sends left "waiting" (writes were off / no permission) go once allowed.
    const w = await retryWaitingPushes();
    if (w.tried) console.log(`[barcodes] retried ${w.tried} waiting Shopify sends`);
  } catch (err) {
    console.error("[barcodes] hourly check failed:", err instanceof Error ? err.message : err);
  }
}

export function startBarcodeCheckScheduler(): void {
  setTimeout(() => void run(), FIRST_RUN_MS).unref();
  setInterval(() => void run(), INTERVAL_MS).unref();
}
