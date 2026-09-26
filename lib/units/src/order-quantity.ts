/**
 * Order quantities — THE conversion between the three ways an order is
 * spoken about: kanban units (what the card on the shelf says: "1 pallet",
 * "2 packs", "10 kg"), supplier packs (what the order line counts and what
 * cost_per_pack prices) and base units (the ingredient's own unit — what
 * stock is kept in and what a received PO line adds to stock).
 *
 * Shared by the API server (/api/orders/calculate) and the browser (the
 * Orders page's own kanban adds, the supplier email / WhatsApp text, the
 * receive screen) so the two can never disagree again. Before this module
 * a "pallet" kanban meant ONE supplier pack on the server and "N pallets ×
 * pack size" in the order text: Ice (Gel pack 500g) — 36 per box, 50 boxes
 * a pallet — was ordered as "36 pallets" when the card said 1 pallet
 * (Graeme, 2026-09-26). A pallet is now a real pallet: pallet_size packs.
 */

/** Pack / bottle noun for an ingredient's unit: bottles for liquids, packs
 *  for everything else. Already-pluralised pack units ("packs" / "bottles")
 *  collapse back to the right singular/plural. */
export function packNoun(unit: string, count: number): string {
  const isLiquid = unit === "ml" || unit === "l" || unit === "L" || unit === "bottle" || unit === "bottles";
  const base = isLiquid ? "bottle" : "pack";
  return count === 1 ? base : `${base}s`;
}

/**
 * Pack size in the item's real unit, at the most natural scale: "500g",
 * "2.27 kg", "330ml", "5 L", "36 each". Never a blanket "kg" — the Orders
 * page used to print every pack size as "<n> kg", so a 5 L tub read as 5 kg
 * and a box of 36 gel packs read as 36 kg.
 */
export function formatPackSize(weight: number | string, nativeUnit: string): string {
  const w = typeof weight === "number" ? weight : Number(weight);
  if (!Number.isFinite(w)) return "";
  const u = nativeUnit;
  const isWeight = u === "g" || u === "kg" || u === "mg";
  const isVolume = u === "ml" || u === "l" || u === "L";
  if (isWeight) {
    const grams = u === "kg" ? w * 1000 : u === "mg" ? w / 1000 : w;
    if (grams < 1000) {
      const rounded = grams % 1 === 0 ? grams : Number(grams.toFixed(1));
      return `${rounded}g`;
    }
    const kg = grams / 1000;
    return `${kg % 1 === 0 ? kg : Number(kg.toFixed(2))} kg`;
  }
  if (isVolume) {
    const ml = u === "l" || u === "L" ? w * 1000 : w;
    if (ml < 1000) {
      const rounded = ml % 1 === 0 ? ml : Number(ml.toFixed(1));
      return `${rounded}ml`;
    }
    const litres = ml / 1000;
    return `${litres % 1 === 0 ? litres : Number(litres.toFixed(2))} L`;
  }
  return `${w % 1 === 0 ? w : Number(w.toFixed(2))} ${u}`;
}

/** A number for people: thousands separators, at most 2 decimals, no
 *  trailing zeros — 1800 → "1,800", 1.5 → "1.5". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

// Count-unit nouns we know how to pluralise. Anything else ("each", "pcs",
// "kg", free text like "each (2.5kg)") is left exactly as typed.
const SINGULAR_NOUNS: Record<string, string> = {
  piece: "pieces", box: "boxes", roll: "rolls", bag: "bags", tin: "tins",
  bottle: "bottles", pack: "packs", case: "cases", tray: "trays", sheet: "sheets",
  punnet: "punnets", bunch: "bunches", tub: "tubs", jar: "jars", carton: "cartons",
};
const PLURAL_NOUNS: Record<string, string> = Object.fromEntries(
  Object.entries(SINGULAR_NOUNS).map(([s, p]) => [p, s]),
);

/** The item's own unit word for a quantity: "1,800 each", "3 boxes",
 *  "1 box", "2 pieces", "12.5 kg", "5 L". */
export function unitWord(unit: string | null | undefined, qty: number): string {
  const raw = (unit ?? "").trim();
  const u = raw.toLowerCase();
  if (u === "l" || u === "litre" || u === "litres" || u === "liter" || u === "liters") return "L";
  if (SINGULAR_NOUNS[u]) return qty === 1 ? u : SINGULAR_NOUNS[u];
  if (PLURAL_NOUNS[u]) return qty === 1 ? PLURAL_NOUNS[u] : u;
  return raw;
}

/** Pack weight as the ordering maths uses it: missing/zero counts each pack
 *  as 1 base unit (the long-standing `Number(packWeight) || 1`). */
export function effectivePackWeight(packWeight: number | string | null | undefined): number {
  const n = Number(packWeight);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Supplier packs per pallet, or null when it isn't set. */
export function positivePalletSize(palletSize: number | string | null | undefined): number | null {
  if (palletSize == null || palletSize === "") return null;
  const n = Number(palletSize);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Guard against float noise (1.1 × 50 = 55.000000000000007) turning a whole
// number of packs into one more pack.
function ceilPacks(n: number): number {
  return Math.ceil(n - 1e-9);
}

export interface OrderItemSizes {
  /** Base units per supplier pack (ingredients.pack_weight). */
  packWeight: number | string | null | undefined;
  /** Supplier packs per pallet (ingredients.pallet_size). */
  palletSize?: number | string | null | undefined;
}

export type OrderQuantityWarning = "pallet-size-missing";

export interface KanbanPacks {
  /** Whole supplier packs to order. */
  packs: number;
  /** "pallet-size-missing": a pallet kanban on an item with no pallet size.
   *  `packs` then falls back to ONE pack per pallet, and the screen must say
   *  so — it is a guess, not an order. */
  warning: OrderQuantityWarning | null;
}

/**
 * One kanban card's order amount → whole supplier packs.
 *  - pallet: amount × pallet_size packs (1 pallet of 50-box pallets = 50);
 *  - weight: the amount is in base units, so ceil(amount ÷ pack weight);
 *  - pack / bottle (and anything else): the amount already counts packs.
 * Case rounding is not applied here — it's a separate step on the line.
 */
export function kanbanOrderPacks(
  amount: number | string | null | undefined,
  kanbanUnit: string | null | undefined,
  item: OrderItemSizes,
): KanbanPacks {
  const n = Number(amount);
  const amt = Number.isFinite(n) && n > 0 ? n : 1;
  if (kanbanUnit === "pallet") {
    const palletSize = positivePalletSize(item.palletSize);
    if (palletSize == null) return { packs: ceilPacks(amt), warning: "pallet-size-missing" };
    return { packs: ceilPacks(amt * palletSize), warning: null };
  }
  if (kanbanUnit === "weight") {
    const pw = Number(item.packWeight);
    return { packs: Number.isFinite(pw) && pw > 0 ? ceilPacks(amt / pw) : ceilPacks(amt), warning: null };
  }
  return { packs: ceilPacks(amt), warning: null };
}

/** Supplier packs → base units (what stock is kept in). */
export function packsToBaseQty(packs: number, packWeight: number | string | null | undefined): number {
  return Math.round(packs * effectivePackWeight(packWeight) * 10000) / 10000;
}

/** Supplier packs → pallets (2 dp), or null when the pallet size isn't set. */
export function palletsForPacks(packs: number, palletSize: number | string | null | undefined): number | null {
  const ps = positivePalletSize(palletSize);
  if (ps == null) return null;
  return Math.round((packs / ps) * 100) / 100;
}

/** Price of one full pallet, or null without a pallet size / pack price. */
export function palletPrice(costPerPack: number, palletSize: number | string | null | undefined): number | null {
  const ps = positivePalletSize(palletSize);
  if (ps == null || !(costPerPack > 0)) return null;
  return Math.round(costPerPack * ps * 100) / 100;
}

function palletWord(pallets: number): string {
  return pallets === 1 ? "pallet" : "pallets";
}

export interface PalletOrderText {
  pallets: number;
  /** Headline for the order line: "1 pallet", "2 pallets",
   *  "1.5 pallets (75 packs)". */
  primary: string;
  /** Sub-line: "50 packs · 1,800 each" (just "2,700 each" when the
   *  headline already names the packs). */
  detail: string;
  /** Unambiguous wording for the supplier: "1 pallet (50 × 36 each)". */
  supplierText: string;
}

/**
 * How an order of `packs` supplier packs reads when the item is ordered by
 * the pallet. Null when the pallet size isn't set (the caller shows the
 * "Pallet size not set" warning and falls back to packs).
 */
export function describePalletOrder(
  packs: number,
  item: OrderItemSizes & { unit: string | null | undefined },
): PalletOrderText | null {
  const pallets = palletsForPacks(packs, item.palletSize);
  if (pallets == null) return null;
  const unit = item.unit ?? "";
  const base = packsToBaseQty(packs, item.packWeight);
  const baseText = `${formatCount(base)} ${unitWord(unit, base)}`.trim();
  const packsText = `${formatCount(packs)} ${packNoun(unit, packs)}`;
  const whole = Number.isInteger(pallets);
  const pw = Number(item.packWeight);
  // A pack of exactly 1 (or no pack size, which the ordering maths counts
  // as 1) quotes the plain count: "1 pallet (600 each)", not "600 × 1 each".
  const hasPackSize = Number.isFinite(pw) && pw > 0 && pw !== 1;
  const perPack = hasPackSize
    ? `${formatCount(packs)} × ${formatPackSize(pw, unit)}`
    : baseText;
  const palletsText = `${formatCount(pallets)} ${palletWord(pallets)}`;
  return {
    pallets,
    primary: whole ? palletsText : `${palletsText} (${packsText})`,
    detail: whole ? `${packsText} · ${baseText}` : baseText,
    supplierText: `${palletsText} (${perPack})`,
  };
}

/**
 * The pallet reading of a goods-in / purchase-order line, for the receive
 * screen: "1 pallet — 50 packs". Handles lines stored as base units, as a
 * pack count ("packs" / "bottles") and legacy lines stored as "pallets".
 * Null unless the item has a pallet size and the line is a whole number of
 * packs adding up to at least one pallet.
 */
export function palletReceiptLabel(
  qty: number,
  lineUnit: string | null | undefined,
  item: OrderItemSizes & { unit?: string | null },
): string | null {
  const ps = positivePalletSize(item.palletSize);
  if (ps == null || !(qty > 0)) return null;
  const nounUnit = item.unit ?? "";
  if (lineUnit === "pallets") {
    const packs = qty * ps;
    return `${formatCount(qty)} ${palletWord(qty)} — ${formatCount(packs)} ${packNoun(nounUnit, packs)}`;
  }
  const packs = lineUnit === "packs" || lineUnit === "bottles"
    ? qty
    : qty / effectivePackWeight(item.packWeight);
  const wholePacks = Math.round(packs);
  if (Math.abs(packs - wholePacks) > 0.001 || wholePacks < ps) return null;
  const pallets = Math.round((wholePacks / ps) * 100) / 100;
  return `${formatCount(pallets)} ${palletWord(pallets)} — ${formatCount(wholePacks)} ${packNoun(nounUnit, wholePacks)}`;
}
