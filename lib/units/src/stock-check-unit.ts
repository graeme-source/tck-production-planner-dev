/**
 * The ONE unit an item is stock-checked in (Graeme, 19 Oct 2026).
 * Objective F (data you can trust).
 *
 * "You have to add a number of whole packs and then a fraction of any
 * additional packs, which is confusing." So every stock check is now two
 * steps: the app says which unit ("This stock check must be recorded in
 * KILOGRAMS"), the person confirms, then types one number in that unit.
 * This module decides the unit and turns the typed number into what the
 * stock tables store — always the ingredient's OWN unit (daily_stock_checks
 * and stock_entries are unchanged).
 *
 * The unit (ingredients.stock_check_unit, migration 0204):
 *   "g" / "kg"  a weight. Only for weighable items (g, kg, ml, l — volumes
 *               at 1 g/ml, the prep room weighs and never uses litres).
 *   "packs"     whole/part packs of the pack size (needs a pack size).
 *   "native"    the item's own count unit ("each", "pieces", "box").
 *   NULL        the default rule, defaultStockCheckUnit:
 *                 stock_in_packs on (with a pack size) → packs (that
 *                 setting already says "stock-checked in whole packs");
 *                 a weight in g or ml → grams (Fresh Basil, 100 g packs);
 *                 a weight in kg or l → kilograms (diced chicken);
 *                 a count unit → its own unit.
 * A stored choice that doesn't fit the item (grams for an "each" item,
 * packs with no pack size) falls back to the default rather than guess.
 */
import { convertQuantity, isWeighable } from "./index";
import { packNoun, unitWord, packsToBaseQty, formatPackSize } from "./order-quantity";

export const STOCK_CHECK_UNITS = ["g", "kg", "packs", "native"] as const;
export type StockCheckUnit = (typeof STOCK_CHECK_UNITS)[number];

export function isStockCheckUnit(v: unknown): v is StockCheckUnit {
  return typeof v === "string" && (STOCK_CHECK_UNITS as readonly string[]).includes(v);
}

export interface StockCheckUnitItem {
  /** The ingredient's own (storage) unit. */
  unit: string;
  packWeight?: number | string | null;
  stockInPacks?: boolean | null;
  /** ingredients.stock_check_unit — null/undefined = the default rule. */
  stockCheckUnit?: string | null;
  /** ingredients.pack_name (#327): "box", "roll" … null = pack / bottle. */
  packName?: string | null;
}

function packSize(item: StockCheckUnitItem): number | null {
  const pw = Number(item.packWeight);
  return Number.isFinite(pw) && pw > 0 ? pw : null;
}

/** The units a manager may pick for this item, default first. */
export function stockCheckUnitOptions(item: StockCheckUnitItem): StockCheckUnit[] {
  const out: StockCheckUnit[] = [];
  const pw = packSize(item);
  if (isWeighable(item.unit)) {
    out.push("g", "kg");
  } else {
    out.push("native");
  }
  // A pack of one "each" is the same as counting each — don't offer it twice.
  if (pw != null && !(pw === 1 && !isWeighable(item.unit))) out.push("packs");
  const def = defaultStockCheckUnit(item);
  return [def, ...out.filter(u => u !== def)];
}

/** The default rule (see the header). */
export function defaultStockCheckUnit(item: StockCheckUnitItem): StockCheckUnit {
  if (item.stockInPacks && packSize(item) != null) return "packs";
  if (!isWeighable(item.unit)) return "native";
  const u = item.unit.toLowerCase().trim();
  return u === "kg" || u === "l" || u.startsWith("lit") ? "kg" : "g";
}

/** The unit this item is counted in: the manager's choice when it fits,
 *  else the default. */
export function resolveStockCheckUnit(item: StockCheckUnitItem): StockCheckUnit {
  const chosen = item.stockCheckUnit;
  if (isStockCheckUnit(chosen) && stockCheckUnitOptions(item).includes(chosen)) return chosen;
  return defaultStockCheckUnit(item);
}

/** Short unit after the number: "g", "kg", "packs", "bottles", "each". */
export function stockCheckUnitSymbol(unit: StockCheckUnit, item: StockCheckUnitItem, qty = 2): string {
  if (unit === "g" || unit === "kg") return unit;
  if (unit === "packs") return packNoun(item.unit, qty, item.packName);
  return unitWord(item.unit, qty) || item.unit;
}

/** The unit spelled out in full, for "must be recorded in KILOGRAMS". */
export function stockCheckUnitName(unit: StockCheckUnit, item: StockCheckUnitItem): string {
  if (unit === "g") return "grams";
  if (unit === "kg") return "kilograms";
  if (unit === "packs") return packNoun(item.unit, 2, item.packName);
  const w = unitWord(item.unit, 2) || item.unit;
  return w.toLowerCase() === "pcs" ? "pieces" : w;
}

/** What one pack is, when counting packs: "1 bottle = 2 L". Null otherwise. */
export function stockCheckPackLabel(unit: StockCheckUnit, item: StockCheckUnitItem): string | null {
  const pw = packSize(item);
  if (unit !== "packs" || pw == null) return null;
  return `1 ${packNoun(item.unit, 1, item.packName)} = ${formatPackSize(pw, item.unit)}`;
}

/**
 * Exactly what to do, in one line (#327): "Count BOXES (1 box = 12 kg)",
 * "Weigh in KILOGRAMS", "Count EACH". Counting for packs and count units,
 * weighing for g / kg.
 */
export function stockCheckInstruction(unit: StockCheckUnit, item: StockCheckUnitItem): { verb: "Count" | "Weigh in"; what: string; detail: string | null } {
  const what = stockCheckUnitName(unit, item).toUpperCase();
  if (unit === "g" || unit === "kg") return { verb: "Weigh in", what, detail: null };
  return { verb: "Count", what, detail: stockCheckPackLabel(unit, item) };
}

/** The typed count (in the check unit) → the ingredient's own unit, which
 *  is what's stored. Null when it can't honestly be worked out. */
export function stockCountToNative(value: number, unit: StockCheckUnit, item: StockCheckUnitItem): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  if (unit === "native") return value;
  if (unit === "packs") {
    const pw = packSize(item);
    return pw == null ? null : packsToBaseQty(value, pw);
  }
  return convertQuantity(value, unit, item.unit);
}

/** The reverse — a stored (own-unit) amount in the check unit. */
export function nativeToStockCount(native: number, unit: StockCheckUnit, item: StockCheckUnitItem): number | null {
  if (!Number.isFinite(native)) return null;
  if (unit === "native") return native;
  if (unit === "packs") {
    const pw = packSize(item);
    return pw == null ? null : native / pw;
  }
  return convertQuantity(native, item.unit, unit);
}

/** A number for people, to the gram on kilograms: 5500 → "5,500",
 *  12.4 → "12.4", 1.2345 → "1.235". */
export function formatStockNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-GB", { maximumFractionDigits: 3 });
}

/** "550 g", "12.4 kg", "3 packs", "24 each". */
export function formatStockCount(value: number, unit: StockCheckUnit, item: StockCheckUnitItem): string {
  return `${formatStockNumber(value)} ${stockCheckUnitSymbol(unit, item, value)}`;
}

/**
 * The plain-words read-back before saving. `entered` is what was typed;
 * `extras` says what that means where a conversion happens — packs for an
 * item with a pack size ("= 5.5 packs"), the stored amount when the item is
 * kept in another unit ("= 0.55 kg saved"), the weight when counting packs.
 */
export function describeStockCount(value: number, unit: StockCheckUnit, item: StockCheckUnitItem): {
  entered: string;
  extras: string[];
  native: number;
} | null {
  const native = stockCountToNative(value, unit, item);
  if (native == null) return null;
  const entered = formatStockCount(value, unit, item);
  const extras: string[] = [];
  const pw = packSize(item);
  const ownUnit = item.unit;
  // Litres/ml counted as kg/g are the same number at 1 g/ml — no "saved"
  // line for those, only for a real change of scale (g counted, kg kept).
  const ownWeight = ["g", "kg"].includes(ownUnit.toLowerCase().trim());
  const sameAsOwn = unit === "native" || !ownWeight || unit.toLowerCase() === ownUnit.toLowerCase().trim();
  if (unit === "packs") {
    if (isWeighable(ownUnit)) {
      const g = convertQuantity(native, ownUnit, "g");
      if (g != null) extras.push(g >= 1000 ? `${formatStockNumber(g / 1000)} kg` : `${formatStockNumber(Math.round(g * 10) / 10)} g`);
    } else {
      extras.push(`${formatStockNumber(native)} ${unitWord(ownUnit, native) || ownUnit}`);
    }
  } else {
    if (!sameAsOwn) extras.push(`${formatStockNumber(native)} ${unitWord(ownUnit, native) || ownUnit} saved`);
    if (pw != null && value > 0 && !(pw === 1 && !isWeighable(ownUnit))) {
      const packs = Math.round((native / pw) * 100) / 100;
      extras.push(`${formatStockNumber(packs)} ${packNoun(ownUnit, packs, item.packName)} of ${formatPackSize(pw, ownUnit)}`);
    }
  }
  return { entered, extras, native };
}
