/**
 * Packing scanner: which line a scanned barcode belongs to, using the LIVE
 * barcode map so a barcode saved in the app scans straight away.
 *
 * The packing page loads its orders (with each line's barcode) only every
 * few minutes. It also keeps a small variant → barcode map from the app's
 * barcode table, refreshed every few seconds and again immediately when a
 * scan finds no match. The map wins over the barcode that came with the
 * orders, because it is newer.
 */
import { gtinKey } from "./set";

export type BarcodeMap = Record<string, string>;

/** The barcode to scan against for a line: the live map's, else the one the
 *  orders arrived with. */
export function barcodeFor(variantId: string | number | null | undefined, orderBarcode: string | null | undefined, live: BarcodeMap | null | undefined): string | null {
  if (variantId != null && live) {
    const v = live[String(variantId)];
    if (v) return v;
  }
  return orderBarcode ?? null;
}

export interface ScanCandidate {
  barcode: string | null;
  sku: string | null;
  title: string | null;
}

/** Barcode first (compared the way scanners read them — a UPC-A read as an
 *  EAN-13 still matches), then the SKU, then a title search for a packer
 *  typing by hand — the same order the page has always used. `input` is the
 *  raw scan. */
export function matchScan<T extends ScanCandidate>(input: string, candidates: T[]): T | null {
  const raw = input.trim();
  if (!raw) return null;
  const key = gtinKey(raw);
  const lower = raw.toLowerCase();
  return (
    candidates.find(c => c.barcode && gtinKey(c.barcode) === key) ??
    candidates.find(c => c.sku?.toLowerCase() === lower || (c.title ?? "").toLowerCase().includes(lower)) ??
    null
  );
}

/** Does a missed scan look like a barcode worth refreshing the live map for
 *  (digits only, a barcode's length) — and has enough time passed since the
 *  last refresh that asking again could help? */
export function shouldRefreshOnMiss(input: string, lastRefreshAt: number | null, now: number, minGapMs = 2_000): boolean {
  const t = input.replace(/[\s-]+/g, "");
  if (!/^\d{8,14}$/.test(t)) return false;
  return lastRefreshAt == null || now - lastRefreshAt >= minGapMs;
}
