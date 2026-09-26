/**
 * How an Orders-page line reads — on screen, in the supplier email /
 * WhatsApp / "Copy order" text, in the Mark-as-Placed payload and when a
 * placed order is reopened for editing. Pure; the conversions themselves
 * come from @workspace/units so the server and this page agree.
 *
 * A line always counts SUPPLIER PACKS in `editedPacks` (what cost_per_pack
 * prices). Lines for items ordered by the pallet carry `orderInPallets` +
 * `palletSize` and read "1 pallet — 50 packs · 1,800 each"; before this the
 * page printed packs × pack size + "pallets" = "36 pallets" (2026-09-26).
 */
import {
  describePalletOrder,
  effectivePackWeight,
  formatCount,
  formatPackSize,
  packNoun,
  palletPrice,
  positivePalletSize,
} from "@workspace/units";

export type OrderLineForText = {
  ingredientName: string;
  supplierPartNumber: string | null;
  /** The line's unit: the ingredient's own unit, or a pack-count unit
   *  ("packs" / "bottles" / legacy "pallets") for pack-counted lines. */
  unit: string;
  /** The ingredient's own unit when `unit` is a pack-count unit. */
  nativeUnit?: string | null;
  packWeight: number;
  costPerPack: number;
  editedPacks: number;
  stockInPacks?: boolean;
  isMisc?: boolean;
  orderInPallets?: boolean;
  palletSize?: number | null;
  palletSizeMissing?: boolean;
};

/** Units whose stored quantity is already a count of packs. */
export function isPackCountUnit(unit: string | null | undefined): boolean {
  return unit === "packs" || unit === "bottles" || unit === "pallets";
}

/** True when the line should read in pallets (pallet item, size known). */
export function readsInPallets(line: OrderLineForText): boolean {
  return !!line.orderInPallets && positivePalletSize(line.palletSize) != null && !isPackCountUnit(line.unit);
}

/** Order Quantity cell: a headline and an optional sub-line. */
export function orderQtyDisplay(line: OrderLineForText): { primary: string; detail: string | null } {
  if (readsInPallets(line)) {
    const d = describePalletOrder(line.editedPacks, line)!;
    return { primary: d.primary, detail: d.detail };
  }
  if (line.stockInPacks || line.unit === "packs" || line.unit === "bottles") {
    return {
      primary: `${formatCount(line.editedPacks)} ${line.stockInPacks ? packNoun(line.unit, line.editedPacks) : line.unit}`,
      detail: null,
    };
  }
  if (line.orderInPallets && !isPackCountUnit(line.unit) && !line.isMisc) {
    // Pallet item without a pallet size: order in packs, say how many.
    return {
      primary: `${formatCount(line.editedPacks * line.packWeight)} ${line.unit}`,
      detail: `${formatCount(line.editedPacks)} ${packNoun(line.unit, line.editedPacks)}`,
    };
  }
  return { primary: `${formatCount(line.editedPacks * line.packWeight)} ${line.unit}`, detail: null };
}

/** The quantity as the supplier should read it in the order message. */
export function lineOrderQty(line: OrderLineForText): string {
  if (readsInPallets(line)) return describePalletOrder(line.editedPacks, line)!.supplierText;
  if (line.stockInPacks || line.unit === "packs" || line.unit === "bottles") {
    return `${line.editedPacks} ${line.stockInPacks ? packNoun(line.unit, line.editedPacks) : line.unit}`;
  }
  return `${(line.editedPacks * line.packWeight).toLocaleString("en-GB")} ${line.unit}`;
}

/** The shared plain-text order message used by the email, WhatsApp and
 *  "Copy order" buttons. */
export function buildOrderMessage(supplierName: string, lines: OrderLineForText[], deliveryDateText: string): string {
  const itemLines = lines.map(l => {
    const part = l.supplierPartNumber ? ` [${l.supplierPartNumber}]` : "";
    return `- ${lineOrderQty(l)} × ${l.ingredientName}${part}`;
  }).join("\n");
  return [
    `Hi ${supplierName},`,
    ``,
    `Please could we order the following for delivery on ${deliveryDateText}:`,
    ``,
    itemLines,
    ``,
    `Many thanks,`,
    `The Calzone Kitchen`,
  ].join("\n");
}

/** Pack Size column: the pack size in the item's real unit ("36 each",
 *  "5 L", "2.5 kg") — never a blanket "kg". "—" when it can't be known. */
export function packSizeLabel(line: OrderLineForText): string {
  if (line.isMisc) return "—";
  const unit = isPackCountUnit(line.unit) ? line.nativeUnit : line.unit;
  if (!unit || !(line.packWeight > 0)) return "—";
  return formatPackSize(line.packWeight, unit);
}

/**
 * Cost per kilo / litre / item — the like-for-like number suppliers' own
 * sites show. Count units read "£0.19 each"; pack-counted lines read per
 * pack/bottle. Null when there's no price or pack size.
 */
export function costPerUnitLabel(line: { costPerPack: number; packWeight: number; unit: string; nativeUnit?: string | null }): string | null {
  if (!(line.costPerPack > 0) || !(line.packWeight > 0)) return null;
  const u = (line.unit || "").toLowerCase().trim();
  if (u === "packs" || u === "bottles" || u === "pallets") {
    return `£${line.costPerPack.toFixed(2)}/${u === "bottles" ? "bottle" : "pack"}`;
  }
  const per = line.costPerPack / line.packWeight;
  if (u === "g") return `£${(line.costPerPack / (line.packWeight / 1000)).toFixed(2)}/kg`;
  if (u === "ml") return `£${(line.costPerPack / (line.packWeight / 1000)).toFixed(2)}/L`;
  if (u === "kg" || u === "l") return `£${per.toFixed(2)}/${u === "l" ? "L" : "kg"}`;
  if (u === "each" || u === "pcs" || u === "") return `£${per.toFixed(2)} each`;
  if (u === "pieces" || u === "piece") return `£${per.toFixed(2)}/piece`;
  return `£${per.toFixed(2)}/${u}`;
}

/** "£342.00/pallet" for pallet lines, else null. */
export function palletPriceLabel(line: OrderLineForText): string | null {
  if (!readsInPallets(line)) return null;
  const price = palletPrice(line.costPerPack, line.palletSize);
  return price == null ? null : `£${price.toFixed(2)}/pallet`;
}

/** Line total: packs × price per pack. */
export function lineTotal(line: { editedPacks: number; costPerPack: number }): number {
  return Math.round(line.editedPacks * line.costPerPack * 100) / 100;
}

/**
 * The PO payload for one line. quantityOrdered is stored the way every
 * other line is and the way goods-in reads it (lib/goods-in-stock.ts):
 * pack-count units store the pack count; everything else stores BASE
 * units (packs × pack size) — so 1 pallet of gel packs saves as 1,800 each
 * and receiving it adds 1,800 each to stock. unitPrice is always per pack.
 * Pallet lines also keep the human wording ("1 pallet (50 × 36 each)") in
 * the line's notes.
 */
export function placedLineQuantity(line: OrderLineForText & { isMisc?: boolean }): {
  quantityOrdered: number;
  unit: string;
  unitPrice: number | null;
  notes: string | null;
} {
  const quantityOrdered = line.isMisc || isPackCountUnit(line.unit)
    ? line.editedPacks
    : Math.round(line.editedPacks * line.packWeight * 10000) / 10000;
  return {
    quantityOrdered,
    unit: line.unit,
    unitPrice: line.costPerPack > 0 ? line.costPerPack : null,
    notes: readsInPallets(line) ? describePalletOrder(line.editedPacks, line)!.supplierText : null,
  };
}

/**
 * Rebuild a pack count from a placed PO line when the order is reopened for
 * editing. Base-unit lines that are a whole number of packs come back as
 * packs of the real pack size (so the line total stays packs × pack price);
 * a legacy "1 pallets" line becomes pallet_size packs in base units. Anything
 * else keeps the old one-unit-per-"pack" reading.
 */
export function hydratePlacedLine(l: {
  quantityOrdered: number;
  unit: string;
  isMisc: boolean;
  packWeight?: number | string | null;
  palletSize?: number | string | null;
  nativeUnit?: string | null;
  kanbanUnit?: string | null;
}): { unit: string; packs: number; packWeight: number; orderInPallets: boolean; palletSize: number | null } {
  const qty = l.quantityOrdered;
  const pwRaw = Number(l.packWeight);
  const hasPackSize = Number.isFinite(pwRaw) && pwRaw > 0;
  const palletSize = positivePalletSize(l.palletSize);
  const orderInPallets = l.kanbanUnit === "pallet";
  if (!l.isMisc && l.unit === "pallets" && palletSize != null && l.nativeUnit) {
    return { unit: l.nativeUnit, packs: Math.round(qty * palletSize), packWeight: effectivePackWeight(l.packWeight), orderInPallets: true, palletSize };
  }
  if (isPackCountUnit(l.unit) || l.isMisc) {
    return { unit: l.unit, packs: qty, packWeight: hasPackSize && !l.isMisc ? pwRaw : 1, orderInPallets: false, palletSize: null };
  }
  if (hasPackSize) {
    const packs = qty / pwRaw;
    const whole = Math.round(packs);
    if (whole >= 1 && Math.abs(packs - whole) < 0.001) {
      return { unit: l.unit, packs: whole, packWeight: pwRaw, orderInPallets, palletSize };
    }
  }
  return { unit: l.unit, packs: Math.max(1, Math.round(qty)), packWeight: 1, orderInPallets: false, palletSize: null };
}
