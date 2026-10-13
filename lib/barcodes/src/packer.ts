/**
 * Packing bench rules for a product with NO barcode (Graeme, 12 Oct 2026):
 *
 *   "If there's no barcode set, the scanning app allows people to manually
 *    check and take something off as manually checked. We don't want to
 *    allow them to do this ever unless I've turned on that setting…
 *    Once they've had a visual check and they're certain it's the right
 *    product, they can set the product's barcode themselves."
 *
 * So:
 *   - Ticking a line by hand (tapping the row) is allowed ONLY when Settings → "Allow manual tap to pick"
 *     (app_settings fulfilment_manual_tick_enabled) is on. A line with no
 *     barcode used to be tappable even with the setting off — that hole is
 *     closed here and enforced again by the server when the order is
 *     completed (an old cached iPad can't get round it). Typing a SKU or
 *     name into the scan box never ticks anything, setting or not (scan.ts).
 *   - Instead the packer checks the pack by eye, scans the barcode printed
 *     on it, and confirms — which saves that barcode for the product, but
 *     only when the product has none. Changing a barcode stays manager-only
 *     (Barcodes page), and a number that already belongs to another product
 *     is refused outright: fetch a manager.
 */
import { checkGtin, type GtinFormat } from "./gtin";
import { gtinKey, type BarcodeHolder } from "./set";

/** May a packer tick this line without scanning it? Only when the manual
 *  setting is on — whether or not the line has a barcode. */
export function canTickByHand(manualTickEnabled: boolean): boolean {
  return manualTickEnabled === true;
}

export interface PackedLine {
  variantId: string | null;
  name: string;
}

/**
 * Server-side completion gate: the lines that could only have been ticked by
 * hand (no barcode to scan) while the manual setting is OFF. Empty = fine to
 * complete. A line with no Shopify variant can never carry a barcode, so it
 * also needs the manual setting.
 */
export function linesNeedingBarcode(
  lines: PackedLine[],
  barcodeOf: (variantId: string) => string | null | undefined,
  manualTickEnabled: boolean,
): PackedLine[] {
  if (canTickByHand(manualTickEnabled)) return [];
  const seen = new Set<string>();
  const out: PackedLine[] = [];
  for (const l of lines) {
    if (l.variantId != null && barcodeOf(l.variantId)) continue;
    const key = l.variantId ?? `name:${l.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

/** Plain words for the refusal when an order still has such lines. */
export function needsBarcodeMessage(lines: PackedLine[]): string {
  const names = lines.map(l => l.name);
  return `${names.join(", ")} ${names.length > 1 ? "have" : "has"} no barcode, and ticking by hand is switched off. Scan the barcode on the pack to set it, then complete the order.`;
}

export type PackerSetPlan =
  | { ok: true; digits: string; format: GtinFormat }
  | { ok: false; why: "invalid" | "has-barcode" | "elsewhere"; reason: string; product?: string };

/**
 * A packer setting the barcode of a product that has none, from the code
 * they just scanned off the pack.
 *
 * `existing` = the barcode the product (its listings) already has in our
 * table, if any — then this is a CHANGE, which is manager-only.
 * `holders` = every other listing we know (as for planAssignment); any
 * listing of a DIFFERENT product holding this number — in our table or in
 * Shopify, current or retired — means a refusal naming that product.
 */
export function planPackerBarcode(
  input: string,
  target: { identityKey: string; name: string; existing: string | null },
  holders: BarcodeHolder[],
): PackerSetPlan {
  const g = checkGtin(input);
  if (!g.ok) {
    return { ok: false, why: "invalid", reason: g.reason === "No barcode number" ? "Scan the barcode on the pack." : `That isn't a valid barcode: ${g.reason}. Scan it again.` };
  }
  if (target.existing) {
    return {
      ok: false, why: "has-barcode",
      reason: `${target.name} already has barcode ${target.existing}. Only a manager can change a barcode — please fetch a manager.`,
    };
  }
  const key = gtinKey(g.digits);
  // Another listing of the SAME product (an F2F copy, a sibling pack
  // listing) already scans with a different number: the pack in hand isn't
  // what we expected, or the product has two codes — a manager decides.
  const sibling = holders.find(h => h.identityKey === target.identityKey && h.current && h.ours != null && gtinKey(h.ours) !== key);
  if (sibling) {
    return {
      ok: false, why: "has-barcode",
      reason: `${target.name} already scans as ${sibling.ours}, not ${g.digits}. Check the pack — only a manager can change a barcode, so please fetch a manager.`,
    };
  }
  const other = holders.find(h => h.identityKey !== target.identityKey
    && ((h.ours != null && gtinKey(h.ours) === key) || (h.shopify != null && gtinKey(h.shopify) === key)));
  if (other) {
    return {
      ok: false, why: "elsewhere", product: other.identityName,
      reason: `${g.digits} is already the barcode of ${other.identityName}, not ${target.name}. Don't pack it — check the pack and fetch a manager.`,
    };
  }
  return { ok: true, digits: g.digits, format: g.format };
}
