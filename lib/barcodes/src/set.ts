/**
 * Setting a barcode in the app: is the number valid, and is it already on
 * another product?
 *
 * A barcode is set per GROUP — one recipe's listings of one kind (its pack
 * listings, its 8-pack bag, its wonky pack). Every listing in a group is the
 * same physical pack, so they share the number; anything outside the group
 * holding the same number would make the packing scanner accept the wrong
 * product, so it is refused, naming the product that has it.
 */
import { checkGtin, type GtinFormat } from "./gtin";

export interface BarcodeHolder {
  variantId: string;
  barcode: string | null;
  /** "Product · Variant" as people know it. */
  name: string;
  /** The recipe it is linked to, if any. */
  recipeName: string | null;
}

export type SetCheck =
  | { ok: true; digits: string; format: GtinFormat }
  | { ok: false; reason: string; clash?: BarcodeHolder };

export function checkNewBarcode(input: string, groupVariantIds: string[], holders: BarcodeHolder[]): SetCheck {
  const g = checkGtin(input);
  if (!g.ok) {
    return { ok: false, reason: g.reason === "No barcode number" ? "Type the barcode number — a barcode can be changed here but not removed, because the packing scanner needs one." : g.reason };
  }
  const group = new Set(groupVariantIds);
  const key = gtinKey(g.digits);
  const clash = holders.find(h => !group.has(h.variantId) && h.barcode != null && gtinKey(h.barcode) === key);
  if (clash) {
    const where = clash.recipeName ? ` (${clash.recipeName})` : " (not linked to a recipe)";
    return { ok: false, reason: `That barcode is already on ${clash.name}${where}. Each product needs its own barcode, or the packing scanner can't tell them apart.`, clash };
  }
  return { ok: true, digits: g.digits, format: g.format };
}

/** Compare GTINs the way scanners do: a 12-digit UPC-A read as a 13-digit
 *  EAN-13 gains a leading 0, so numbers are compared left-padded to 14.
 *  Non-numeric input is compared as typed (lower-case). */
export function gtinKey(code: string): string {
  const t = code.replace(/[\s-]+/g, "");
  return /^\d{1,14}$/.test(t) ? t.padStart(14, "0") : t.toLowerCase();
}
