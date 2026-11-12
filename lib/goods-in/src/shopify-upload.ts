/**
 * Goods-in → Shopify stock for bought-in retail items (the brownies): an
 * ingredient linked to a Shopify variant has what's received added straight
 * to the store, so it goes on sale. Because that puts stock in front of
 * customers, the receiver confirms it on a second screen and types the
 * number again (Graeme, 28 Oct 2026). The server pushes only when the screen
 * says that happened. Objectives C and D.
 */

export const SHOPIFY_UPLOAD_WARNING =
  "This will upload this quantity and recipe directly to Shopify and begin selling it. Please confirm the quantity again.";
export const SHOPIFY_UPLOAD_CONFIRM = "Yep, that quantity and recipe is accurate. Upload";
export const SHOPIFY_UPLOAD_NOT_CONFIRMED =
  "Not sent — the Shopify upload wasn't confirmed on screen. Update the store stock by hand, or open the delivery and save it again.";

/** Line units that already count supplier packs. */
const PACK_LINE_UNITS = new Set(["packs", "pack", "bottles", "pallets"]);

/** How a purchase-order line is counted, so a receipt can be turned into packs. */
export interface ShopifyLineUnit {
  unit?: string | null;
  /** How many of the ingredient's own unit are in one supplier pack (12 pieces). */
  packWeight?: number | string | null;
}

/** The received change as supplier packs. A line counted in packs already is;
 *  a line in the ingredient's own unit (pieces, g) is divided by the pack
 *  size. Without a pack size the line is taken as packs, as before. */
function receivedPacks(receivedDelta: number, line: ShopifyLineUnit | undefined): number {
  const delta = Number(receivedDelta);
  if (!line?.unit || PACK_LINE_UNITS.has(line.unit)) return delta;
  const pw = Number(line.packWeight);
  return Number.isFinite(pw) && pw > 0 ? delta / pw : delta;
}

/** Units added to (or, on an edit that lowers a receipt, taken off) Shopify
 *  for a change in the received quantity: the change in supplier packs × the
 *  ingredient's units per pack (blank = 1), to whole units.
 *
 *  Graeme, 12 Nov 2026: 2 packs of 12 caramel shortbread offered "Adds 288 to
 *  Shopify". The line was ordered as 24 pieces, and 24 was multiplied by 12
 *  per pack as if it were 24 packs. Pass the line's unit and pack size. */
export function shopifyUnitsFor(receivedDelta: number, unitsPerPack: number | string | null | undefined, line?: ShopifyLineUnit): number {
  const perPack = Number(unitsPerPack) || 1;
  const units = Math.round(receivedPacks(receivedDelta, line) * perPack);
  return Number.isFinite(units) ? units : 0;
}

export interface ShopifyUploadLine {
  lineId: number;
  name: string;
  variantId: string | null | undefined;
  productTitle: string | null | undefined;
  variantTitle: string | null | undefined;
  unitsPerPack: number | string | null | undefined;
  /** The line's unit ("packs", "pieces") and the pack size, so a line in
   *  pieces isn't multiplied as if it were packs. */
  unit?: string | null;
  packWeight?: number | string | null;
  /** Received on an earlier save (0 for a first goods-in). */
  previousReceived: number;
  /** What this save will record as received. */
  newReceived: number;
}

export interface ShopifyUpload {
  lineId: number;
  name: string;
  /** The Shopify product it goes on, as the store names it. */
  product: string;
  /** Positive = added to Shopify; negative = taken off (an edit). */
  units: number;
}

/** The Shopify stock changes this save would make — one per linked line
 *  whose received quantity changes. Empty = no confirmation needed. */
export function shopifyUploadsOf(lines: ShopifyUploadLine[]): ShopifyUpload[] {
  const out: ShopifyUpload[] = [];
  for (const l of lines) {
    if (!l.variantId) continue;
    const units = shopifyUnitsFor(l.newReceived - l.previousReceived, l.unitsPerPack, { unit: l.unit, packWeight: l.packWeight });
    if (units === 0) continue;
    const variant = l.variantTitle && l.variantTitle !== "Default Title" ? ` — ${l.variantTitle}` : "";
    out.push({ lineId: l.lineId, name: l.name, product: `${l.productTitle || l.name}${variant}`, units });
  }
  return out;
}

/** The typed-again number matches what will go to Shopify (whole units). */
export function shopifyQuantityConfirmed(typed: string, units: number): boolean {
  const t = typed.trim();
  return /^\d+$/.test(t) && Number(t) === Math.abs(units);
}
