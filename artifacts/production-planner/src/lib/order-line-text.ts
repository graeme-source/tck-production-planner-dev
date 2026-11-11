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
import { DEFAULT_ORDER_EMAIL_TEMPLATE, fillOrderEmailBody, fillOrderEmailText, type OrderEmailTemplate } from "./order-email-template";

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
  /** What one pack is called — "box", "roll" (#327). Null = pack / bottle. */
  packName?: string | null;
};

/** Units whose stored quantity is already a count of packs. */
export function isPackCountUnit(unit: string | null | undefined): boolean {
  return unit === "packs" || unit === "bottles" || unit === "pallets";
}

/** True when the line should read in pallets (pallet item, size known). */
export function readsInPallets(line: OrderLineForText): boolean {
  return !!line.orderInPallets && positivePalletSize(line.palletSize) != null && !isPackCountUnit(line.unit);
}

/** Units that count single items ("18 pieces"), as opposed to weights. */
const COUNT_UNITS = new Set(["pieces", "piece", "each", "unit", "units", "pcs", "pc", "rolls", "roll"]);

/**
 * A count item bought in cases (a case of 6 sauce bottles): the case count
 * leads and the items follow — "3 packs" / "18 pieces" — however the line
 * got onto the card. A pulled kanban read "8 packs" while the same kind of
 * item added by hand read "18 pieces", so it wasn't clear what to order
 * (Graeme, 11 Nov 2026). Returns the item unit, or null when it doesn't apply.
 */
function caseOfCountUnit(line: OrderLineForText): string | null {
  if (line.isMisc || line.orderInPallets || !(line.packWeight > 1)) return null;
  const unit = isPackCountUnit(line.unit) ? line.nativeUnit : line.unit;
  return unit && COUNT_UNITS.has(unit) ? unit : null;
}

/** Order Quantity cell: a headline and an optional sub-line. */
export function orderQtyDisplay(line: OrderLineForText): { primary: string; detail: string | null } {
  if (readsInPallets(line)) {
    const d = describePalletOrder(line.editedPacks, line)!;
    return { primary: d.primary, detail: d.detail };
  }
  const itemUnit = caseOfCountUnit(line);
  if (itemUnit) {
    return {
      primary: `${formatCount(line.editedPacks)} ${packNoun(itemUnit, line.editedPacks, line.packName)}`,
      detail: line.editedPacks > 0 ? `${formatCount(line.editedPacks * line.packWeight)} ${itemUnit}` : null,
    };
  }
  if (line.stockInPacks || line.unit === "packs" || line.unit === "bottles") {
    return {
      primary: `${formatCount(line.editedPacks)} ${line.stockInPacks || line.packName ? packNoun(line.unit, line.editedPacks, line.packName) : line.unit}`,
      detail: null,
    };
  }
  if (line.orderInPallets && !isPackCountUnit(line.unit) && !line.isMisc) {
    // Pallet item without a pallet size: order in packs, say how many.
    return {
      primary: `${formatCount(line.editedPacks * line.packWeight)} ${line.unit}`,
      detail: `${formatCount(line.editedPacks)} ${packNoun(line.unit, line.editedPacks, line.packName)}`,
    };
  }
  return {
    primary: `${formatCount(line.editedPacks * line.packWeight)} ${line.unit}`,
    // A named pack (#327) also says how many of them: "24 kg" / "2 boxes".
    detail: line.packName && !line.isMisc && line.editedPacks > 0
      ? `${formatCount(line.editedPacks)} ${packNoun(line.unit, line.editedPacks, line.packName)}`
      : null,
  };
}

/** The quantity as the supplier should read it in the order message. */
export function lineOrderQty(line: OrderLineForText): string {
  if (readsInPallets(line)) return describePalletOrder(line.editedPacks, line)!.supplierText;
  const itemUnit = caseOfCountUnit(line);
  if (itemUnit) {
    return `${line.editedPacks} ${packNoun(itemUnit, line.editedPacks, line.packName)} (${(line.editedPacks * line.packWeight).toLocaleString("en-GB")} ${itemUnit})`;
  }
  if (line.stockInPacks || line.unit === "packs" || line.unit === "bottles") {
    return `${line.editedPacks} ${line.stockInPacks || line.packName ? packNoun(line.unit, line.editedPacks, line.packName) : line.unit}`;
  }
  return `${(line.editedPacks * line.packWeight).toLocaleString("en-GB")} ${line.unit}`;
}

/** What the order wording can use beyond the order itself. */
export interface OrderMessageExtras {
  template?: OrderEmailTemplate;
  contactName?: string | null;
  accountNumber?: string | null;
}

function orderItemLine(l: OrderLineForText, t: OrderEmailTemplate): string {
  const part = t.showPartNumber && l.supplierPartNumber ? ` [${l.supplierPartNumber}]` : "";
  const size = t.showPackSize ? packSizeLabel(l) : "—";
  const pack = size !== "—" ? ` (${size})` : "";
  const price = t.showPrice && l.costPerPack > 0 ? ` at £${l.costPerPack.toFixed(2)} per ${packNoun(l.unit, 1, l.packName)}` : "";
  return `- ${lineOrderQty(l)} × ${l.ingredientName}${part}${pack}${price}`;
}

/** The shared plain-text order message used by the email, WhatsApp and
 *  "Copy order" buttons, in the wording set on the template. */
export function buildOrderMessage(supplierName: string, lines: OrderLineForText[], deliveryDateText: string, extras: OrderMessageExtras = {}): string {
  const template = extras.template ?? DEFAULT_ORDER_EMAIL_TEMPLATE;
  return fillOrderEmailBody(template, {
    supplier: supplierName,
    contact: extras.contactName?.trim() || supplierName,
    accountNumber: extras.accountNumber,
    deliveryDate: deliveryDateText,
    items: lines.map(l => orderItemLine(l, template)).join("\n"),
  });
}

export function orderEmailSubject(supplierName: string, deliveryDateText: string, extras: OrderMessageExtras = {}): string {
  return fillOrderEmailText((extras.template ?? DEFAULT_ORDER_EMAIL_TEMPLATE).subject, {
    supplier: supplierName,
    contact: extras.contactName?.trim() || supplierName,
    accountNumber: extras.accountNumber,
    deliveryDate: deliveryDateText,
  });
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
export function costPerUnitLabel(line: { costPerPack: number; packWeight: number; unit: string; nativeUnit?: string | null; packName?: string | null }): string | null {
  if (!(line.costPerPack > 0) || !(line.packWeight > 0)) return null;
  const u = (line.unit || "").toLowerCase().trim();
  if (u === "packs" || u === "bottles" || u === "pallets") {
    return `£${line.costPerPack.toFixed(2)}/${line.packName ? packNoun(u, 1, line.packName) : u === "bottles" ? "bottle" : "pack"}`;
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
  return price == null
    ? null
    : `£${price.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/pallet`;
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
