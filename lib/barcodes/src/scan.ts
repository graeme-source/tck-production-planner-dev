/**
 * Packing scanner: what a scanned code means for the order on screen.
 * Safety first — packing the wrong item is hugely expensive (Graeme,
 * 2026-10-10):
 *
 *   - A scanner sends digits. Digits must match a line's barcode EXACTLY
 *     (compared as GTINs). There is no SKU or title fallback for them.
 *   - A code we know belongs to another product → "Wrong item — this is
 *     <product>", never a tick.
 *   - A code that matches lines of two different products → refused, check.
 *   - Typed text (not digits) may tick a line by its exact SKU or exact
 *     title — a deliberate manual entry — unless that is ambiguous.
 *   - A line with no barcode on record is never ticked by a guess; the page
 *     shows "No barcode — check by eye and tap to confirm".
 *
 * Barcodes come from the app's table via a live map the page refreshes
 * every few seconds and again immediately when a scan misses, so a barcode
 * saved in the app scans straight away. Codes are already resolved to one
 * product each on the server (identity.ts).
 */
import { gtinKey } from "./set";

export type BarcodeMap = Record<string, string>;

/** The barcode to scan against for a line. Once the live map has loaded it
 *  is the only authority (a variant missing from it has no barcode — e.g.
 *  a retired or clashing one); before that, the barcode the orders came with. */
export function barcodeFor(variantId: string | number | null | undefined, orderBarcode: string | null | undefined, live: BarcodeMap | null | undefined): string | null {
  if (live) return variantId != null ? live[String(variantId)] ?? null : null;
  return orderBarcode ?? null;
}

export interface ScanLine {
  key: string;
  barcode: string | null;
  /** Product identity (identity.ts); null when unknown — the line key is used. */
  identityKey: string | null;
  name: string;
  sku: string | null;
  title: string | null;
  /** Units still to pick on this line. */
  remaining: number;
}

/** gtinKey(code) → the product that code belongs to (every product we know). */
export type KnownCodes = Record<string, { identityKey: string; name: string }>;

export type ScanDecision =
  | { kind: "tick"; key: string }
  | { kind: "already-picked"; key: string; name: string }
  | { kind: "wrong-item"; product: string }
  | { kind: "ambiguous"; products: string[] }
  | { kind: "unknown-barcode" }
  | { kind: "no-match" };

const isDigits = (s: string) => /^\d+$/.test(s);

export function decideScan(input: string, lines: ScanLine[], known: KnownCodes): ScanDecision {
  const raw = input.trim();
  if (!raw) return { kind: "no-match" };
  const compact = raw.replace(/[\s-]+/g, "");
  const idOf = (l: ScanLine) => l.identityKey ?? `line:${l.key}`;
  const distinctProducts = (ls: ScanLine[]) => [...new Map(ls.map(l => [idOf(l), l.name])).values()];

  if (isDigits(compact)) {
    const k = gtinKey(compact);
    const matches = lines.filter(l => l.barcode && gtinKey(l.barcode) === k);
    const products = distinctProducts(matches);
    if (products.length > 1) return { kind: "ambiguous", products };
    const open = matches.find(l => l.remaining > 0);
    if (open) return { kind: "tick", key: open.key };
    if (matches.length) return { kind: "already-picked", key: matches[0].key, name: matches[0].name };
    const owner = known[k];
    if (owner) return { kind: "wrong-item", product: owner.name };
    return { kind: "unknown-barcode" };
  }

  // Typed by hand: exact SKU or exact title only.
  const lower = raw.toLowerCase();
  const matches = lines.filter(l => l.remaining > 0 && (l.sku?.toLowerCase() === lower || (l.title ?? "").toLowerCase() === lower));
  const products = distinctProducts(matches);
  if (products.length > 1) return { kind: "ambiguous", products };
  if (matches.length) return { kind: "tick", key: matches[0].key };
  return { kind: "no-match" };
}

/** Plain words for the red flash, and the reason logged for a refusal. */
export function scanMessage(d: ScanDecision): string | null {
  switch (d.kind) {
    case "tick": return null;
    case "already-picked": return `All of ${d.name} are already picked.`;
    case "wrong-item": return `Wrong item — this is ${d.product}.`;
    case "ambiguous": return `This code matches ${d.products.join(" and ")} — check the pack by eye.`;
    case "unknown-barcode": return "Barcode not recognised — check the pack by eye.";
    case "no-match": return "No exact match on this order.";
  }
}

/** Does a missed scan look like a barcode worth refreshing the live map for
 *  (digits only, a barcode's length) — and has enough time passed since the
 *  last refresh that asking again could help? */
export function shouldRefreshOnMiss(input: string, lastRefreshAt: number | null, now: number, minGapMs = 2_000): boolean {
  const t = input.replace(/[\s-]+/g, "");
  if (!/^\d{8,14}$/.test(t)) return false;
  return lastRefreshAt == null || now - lastRefreshAt >= minGapMs;
}

/** The packing scan queue's barcodes: from OUR table for every variant we
 *  hold a row for (a row with no barcode means "none" — not a reason to ask
 *  Shopify); Shopify is asked only for variants we have never seen, and the
 *  caller stores what comes back so next time it is ours. */
export function planScanBarcodes(variantIds: string[], ours: Map<string, string | null>): { barcodes: BarcodeMap; askShopify: string[] } {
  const barcodes: BarcodeMap = {};
  const askShopify: string[] = [];
  for (const id of new Set(variantIds)) {
    if (!ours.has(id)) { askShopify.push(id); continue; }
    const b = ours.get(id);
    if (b) barcodes[id] = b;
  }
  return { barcodes, askShopify };
}
