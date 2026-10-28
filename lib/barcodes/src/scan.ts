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
 *   - ONLY a barcode ticks a line (Graeme, 13 Oct 2026): "Typing a SKU or
 *     product name into the packing scan box should not take products off
 *     that have a barcode. The only thing that should tick products off on
 *     the packing screen is scanning a barcode." Typed text (a SKU, a name)
 *     never ticks anything, whatever Settings → "Allow manual tap to pick"
 *     says — that setting governs TAPPING a row only.
 *   - A line with no barcode on record is never ticked by a guess. With the
 *     manual setting off it can't be ticked by hand either: the packer
 *     checks it by eye and scans the pack to SET its barcode (packer.ts).
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
  /** Units still to pick on this line. */
  remaining: number;
  /** Other codes this line accepts, each with the product it belongs to —
   *  only the Calzone Club Special during a changeover (copies.ts). */
  alsoAccepts?: Array<{ code: string; identityKey: string; name: string }>;
}

/** gtinKey(code) → the product that code belongs to (every product we know). */
export type KnownCodes = Record<string, { identityKey: string; name: string }>;

export type ScanDecision =
  | { kind: "tick"; key: string }
  | { kind: "already-picked"; key: string; name: string }
  | { kind: "wrong-item"; product: string }
  | { kind: "ambiguous"; products: string[] }
  | { kind: "unknown-barcode" }
  /** Text that isn't a barcode (a SKU, a product name) — never ticks. */
  | { kind: "typed-not-scanned" }
  | { kind: "no-match" };

/** Every refusal the packing scan box can log — one list for the API's
 *  validation and the packing_scan_rejections CHECK constraint (a kind added
 *  here needs a migration widening it; scan-rejection-kinds.test.ts checks). */
export const SCAN_REJECTION_KINDS = [
  "wrong-item", "ambiguous", "unknown-barcode", "typed-not-scanned", "no-match", "already-picked",
] as const;
export type ScanRejectionKind = typeof SCAN_REJECTION_KINDS[number];

const isDigits = (s: string) => /^\d+$/.test(s);

/** What a value entered in the packing scan box means. Only a barcode
 *  (digits, compared as GTINs) can tick a line; anything else is
 *  "typed-not-scanned" and ticks nothing — there is deliberately no option
 *  to change that. */
export function decideScan(input: string, lines: ScanLine[], known: KnownCodes): ScanDecision {
  const raw = input.trim();
  if (!raw) return { kind: "no-match" };
  const compact = raw.replace(/[\s-]+/g, "");
  const idOf = (l: ScanLine) => l.identityKey ?? `line:${l.key}`;

  if (isDigits(compact)) {
    const k = gtinKey(compact);
    // Each matching line, with the product the CODE belongs to: the line's
    // own for its barcode, the named one for an "also accepts" code. Two
    // different products → refuse.
    const hits: Array<{ line: ScanLine; productKey: string; name: string }> = [];
    for (const l of lines) {
      if (l.barcode && gtinKey(l.barcode) === k) hits.push({ line: l, productKey: idOf(l), name: l.name });
      else {
        const alt = l.alsoAccepts?.find(a => gtinKey(a.code) === k);
        if (alt) hits.push({ line: l, productKey: alt.identityKey, name: alt.name });
      }
    }
    const matches = hits.map(h => h.line);
    const products = [...new Map(hits.map(h => [h.productKey, h.name])).values()];
    if (products.length > 1) return { kind: "ambiguous", products };
    const open = matches.find(l => l.remaining > 0);
    if (open) return { kind: "tick", key: open.key };
    if (matches.length) return { kind: "already-picked", key: matches[0].key, name: matches[0].name };
    const owner = known[k];
    if (owner) return { kind: "wrong-item", product: owner.name };
    return { kind: "unknown-barcode" };
  }

  // Not a barcode — a typed SKU or product name. Never a tick.
  return { kind: "typed-not-scanned" };
}

/** Shown when someone types a SKU or name into the scan box. */
export const TYPED_NOT_SCANNED_MESSAGE = "Scan the barcode on the pack — typing a name or SKU doesn't tick it off.";

/** Plain words for the red flash, and the reason logged for a refusal. */
export function scanMessage(d: ScanDecision): string | null {
  switch (d.kind) {
    case "tick": return null;
    case "already-picked": return `All of ${d.name} are already picked.`;
    case "wrong-item": return `Wrong item — this is ${d.product}.`;
    case "ambiguous": return `This code matches ${d.products.join(" and ")} — check the pack by eye.`;
    case "unknown-barcode": return "Barcode not recognised — check the pack by eye.";
    case "typed-not-scanned": return TYPED_NOT_SCANNED_MESSAGE;
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
