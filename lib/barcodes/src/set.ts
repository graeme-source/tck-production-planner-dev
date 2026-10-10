/**
 * Setting a barcode in the app: is the number valid, and who else has it?
 *
 * A barcode is set per GROUP — one recipe's listings of one kind (its pack
 * listings, its 8-pack bag, its wonky pack). Every listing in a group is the
 * same physical pack, so they share the number.
 *
 * TCK reuses the barcodes of retired products (no spare GS1 numbers), so a
 * number already on another product is not simply refused — it is MOVED,
 * with a confirmation:
 *   - held by an old / retired product (or only by a Shopify listing we
 *     don't use): "This barcode belongs to <old product>. Move it to <new>?"
 *   - held in our table by a CURRENT product: a second, explicit
 *     confirmation naming both — that product will have NO barcode and
 *     can't be scanned until it gets one.
 * On confirmation the old holders are released (their barcode in our table
 * cleared) and the group gets it; both are logged. Product identity rules:
 * identity.ts.
 */
import { checkGtin, type GtinFormat } from "./gtin";

export interface BarcodeHolder {
  variantId: string;
  /** "Product · Variant" as people know it. */
  name: string;
  /** Identity key (identity.ts) — holders of the target's identity are fine. */
  identityKey: string;
  /** "The Godfather · 2-pack", or the variant's name. */
  identityName: string;
  current: boolean;
  /** The code in OUR table (what the scanner uses). */
  ours: string | null;
  /** The code Shopify had at the last check. */
  shopify: string | null;
}

export type Confirmation = "move" | "take";

export type AssignPlan =
  | { ok: true; digits: string; format: GtinFormat; release: string[]; movedFrom: string[] }
  | { ok: false; reason: string }
  | { ok: false; confirm: Confirmation; reason: string; holders: string[] };

/**
 * `confirmed` = the confirmations the person has already given. A "take"
 * confirmation implies "move".
 */
export function planAssignment(
  input: string,
  target: { identityKey: string; name: string },
  holders: BarcodeHolder[],
  confirmed: { move?: boolean; take?: boolean } = {},
): AssignPlan {
  const g = checkGtin(input);
  if (!g.ok) {
    return { ok: false, reason: g.reason === "No barcode number" ? "Type the barcode number — a barcode can be changed here but not removed, because the packing scanner needs one." : g.reason };
  }
  const key = gtinKey(g.digits);
  const others = holders.filter(h => h.identityKey !== target.identityKey);
  const inOurs = others.filter(h => h.ours != null && gtinKey(h.ours) === key);
  const inShopifyOnly = others.filter(h => !inOurs.includes(h) && h.shopify != null && gtinKey(h.shopify) === key);
  const identityNames = (hs: BarcodeHolder[]) => [...new Set(hs.map(h => h.identityName))];

  const currentInOurs = inOurs.filter(h => h.current);
  if (currentInOurs.length && !confirmed.take) {
    const names = identityNames(currentInOurs);
    return {
      ok: false, confirm: "take", holders: names,
      reason: `${g.digits} is the barcode of ${names.join(" and ")}, a current product. If you move it to ${target.name}, ${names.join(" and ")} will have NO barcode and can't be scanned until it gets one.`,
    };
  }
  const old = [...inOurs.filter(h => !h.current), ...inShopifyOnly];
  if (old.length && !confirmed.move && !confirmed.take) {
    const names = identityNames(old);
    return {
      ok: false, confirm: "move", holders: names,
      reason: `This barcode belongs to ${names.join(" and ")}. Move it to ${target.name}?`,
    };
  }
  return { ok: true, digits: g.digits, format: g.format, release: inOurs.map(h => h.variantId), movedFrom: identityNames([...inOurs, ...inShopifyOnly]) };
}

/** Compare GTINs the way scanners do: a 12-digit UPC-A read as a 13-digit
 *  EAN-13 gains a leading 0, so numbers are compared left-padded to 14.
 *  Non-numeric input is compared as typed (lower-case). */
export function gtinKey(code: string): string {
  const t = code.replace(/[\s-]+/g, "");
  return /^\d{1,14}$/.test(t) ? t.padStart(14, "0") : t.toLowerCase();
}
