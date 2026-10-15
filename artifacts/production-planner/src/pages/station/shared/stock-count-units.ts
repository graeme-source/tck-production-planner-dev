/**
 * Stock counts the way people physically count (Graeme, 15 Oct 2026).
 * Objective F (data you can trust).
 *
 * The old stock-check box asked "how many <unit>" with the unit fixed by the
 * ingredient's settings, and people reliably typed the wrong thing — Fresh
 * Basil (stored in g, bought in 100 g packs) was counted as "5 g" when it
 * was 5 packs. Graeme: "a much more robust solution that doesn't require
 * someone to think hard when entering". So nobody converts or picks a unit:
 *
 *  - Ingredient with a pack size → count FULL packs (a stepper) and say how
 *    much of the opened pack is left (None / ¼ / ½ / ¾, or weigh it). The
 *    app works out the total.
 *  - No pack size → one field in the ingredient's own unit, unit shown big
 *    with an example ("kg — e.g. 2.5").
 *
 * Then a plain-English read-back ("3 full packs + ½ a pack = 350 g") and an
 * "are you sure?" when the total is way out against recent counts. Stored in
 * the ingredient's own unit, as ever. All unit maths via @workspace/units.
 */
import {
  convertQuantity,
  formatCount,
  formatPackSize,
  formatPrepWeight,
  isWeighable,
  packNoun,
  packsToBaseQty,
  unitWord,
} from "@workspace/units";

export interface StockCountIngredient {
  /** The ingredient's own (storage) unit — what the endpoint stores. */
  unit: string;
  packWeight?: number | string | null;
}

/** The pack size when the ingredient has one, else null. */
export function stockPackWeight(ing: StockCountIngredient): number | null {
  const pw = Number(ing.packWeight);
  return Number.isFinite(pw) && pw > 0 ? pw : null;
}

/** "packs" — count full packs + the opened one; "native" — one amount. */
export function stockCountMode(ing: StockCountIngredient): "packs" | "native" {
  return stockPackWeight(ing) != null ? "packs" : "native";
}

/** How a stored native amount reads: weights as prep weights ("500 g",
 *  "2.500 kg"), counts in their own word. */
export function formatNativeStock(nativeQty: number, ing: StockCountIngredient): string {
  if (isWeighable(ing.unit)) return formatPrepWeight(nativeQty, ing.unit);
  return `${formatCount(nativeQty)} ${unitWord(ing.unit, nativeQty)}`.trim();
}

/** "100g pack", "5 L bottle" — what one pack is, for labels. */
export function packLabel(ing: StockCountIngredient): string {
  const pw = stockPackWeight(ing);
  const noun = packNoun(ing.unit, 1);
  return pw == null ? noun : `${formatPackSize(pw, ing.unit)} ${noun}`;
}

/** The unit an odd opened-pack amount is weighed in: grams for anything
 *  weighable (the prep room weighs — never litres), else the own unit. */
export function openedCustomUnit(ing: StockCountIngredient): string {
  return isWeighable(ing.unit) ? "g" : ing.unit;
}

/** Opened pack: a fraction of a pack, or an odd amount weighed. */
export type OpenedPack =
  | { kind: "fraction"; fraction: 0 | 0.25 | 0.5 | 0.75 }
  | { kind: "custom"; amount: number };

export const OPENED_FRACTIONS: ReadonlyArray<{ fraction: 0 | 0.25 | 0.5 | 0.75; label: string }> = [
  { fraction: 0, label: "None" },
  { fraction: 0.25, label: "¼" },
  { fraction: 0.5, label: "½" },
  { fraction: 0.75, label: "¾" },
];

/** Full packs + opened pack → total in the ingredient's own unit. Null when
 *  it can't be worked out (no pack size, bad numbers). */
export function packCountToNative(fullPacks: number, opened: OpenedPack, ing: StockCountIngredient): number | null {
  const pw = stockPackWeight(ing);
  if (pw == null || !Number.isFinite(fullPacks) || fullPacks < 0) return null;
  const full = packsToBaseQty(fullPacks, pw);
  if (opened.kind === "fraction") return full + packsToBaseQty(opened.fraction, pw);
  if (!Number.isFinite(opened.amount) || opened.amount < 0) return null;
  const openedNative = convertQuantity(opened.amount, openedCustomUnit(ing), ing.unit);
  return openedNative == null ? null : full + openedNative;
}

const FRACTION_WORDS: Record<number, string> = { 0.25: "¼", 0.5: "½", 0.75: "¾" };

/** "3 full packs + ½ a pack = 350 g" — the read-back before saving. */
export function describePackCount(fullPacks: number, opened: OpenedPack, ing: StockCountIngredient): string | null {
  const total = packCountToNative(fullPacks, opened, ing);
  if (total == null) return null;
  const noun1 = packNoun(ing.unit, 1);
  const parts: string[] = [];
  if (fullPacks > 0) parts.push(`${formatCount(fullPacks)} full ${packNoun(ing.unit, fullPacks)}`);
  if (opened.kind === "fraction" && opened.fraction > 0) {
    parts.push(`${FRACTION_WORDS[opened.fraction]} a ${noun1}`);
  } else if (opened.kind === "custom" && opened.amount > 0) {
    const u = openedCustomUnit(ing);
    parts.push(`an opened ${noun1} of ${formatNativeStock(opened.amount, { unit: u })}`);
  }
  if (parts.length === 0) return `Nothing left = ${formatNativeStock(0, ing)}`;
  return `${parts.join(" + ")} = ${formatNativeStock(total, ing)}`;
}

/** Example for the single-amount field: "e.g. 2.5" for kg, "e.g. 250" for g. */
export function nativeExample(unit: string): string {
  const u = unit.toLowerCase();
  if (u === "kg" || u === "l") return "e.g. 2.5";
  if (u === "g" || u === "ml") return "e.g. 250";
  return "e.g. 12";
}

export type StockCountSanity =
  | { level: "ok" }
  | { level: "warn"; direction: "high" | "low"; basis: "recent" | "plan"; typicalNative: number };

/** Times more / fewer than the usual count before we ask "check?". */
export const SANITY_RATIO = 5;
/** Counts needed before history is trusted as "usual". */
export const MIN_HISTORY = 2;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Is this count way out? Against the median of the ingredient's recent
 * non-zero counts: more than 5× or under a fifth asks for a second tap.
 * With too little history, falls back to today's plan need: more than 5×
 * asks. (Plan need is the fallback only — dry goods routinely hold many
 * days' stock, and asking every day teaches people to tap through; and
 * stock under a fifth of the need is normal once it's been used.) Zero is
 * never questioned — "nothing left" is a real count.
 */
export function stockCountSanity(input: {
  nativeQty: number;
  recentNative?: number[] | null;
  planNeedNative?: number | null;
}): StockCountSanity {
  const { nativeQty } = input;
  if (!Number.isFinite(nativeQty) || nativeQty <= 0) return { level: "ok" };
  const recent = (input.recentNative ?? []).filter(v => Number.isFinite(v) && v > 0);
  if (recent.length >= MIN_HISTORY) {
    const typical = median(recent);
    if (nativeQty > typical * SANITY_RATIO) return { level: "warn", direction: "high", basis: "recent", typicalNative: typical };
    if (nativeQty < typical / SANITY_RATIO) return { level: "warn", direction: "low", basis: "recent", typicalNative: typical };
    return { level: "ok" };
  }
  const need = Number(input.planNeedNative);
  if (Number.isFinite(need) && need > 0 && nativeQty > need * SANITY_RATIO) {
    return { level: "warn", direction: "high", basis: "plan", typicalNative: need };
  }
  return { level: "ok" };
}

/** The "check?" sentence for a warning. */
export function sanityMessage(s: StockCountSanity, ing: StockCountIngredient): string | null {
  if (s.level !== "warn") return null;
  const typical = formatNativeStock(s.typicalNative, ing);
  if (s.basis === "plan") return `That's a lot more than today's plan needs (${typical}) — check?`;
  return s.direction === "high"
    ? `That's a lot more than usual (usually about ${typical}) — check?`
    : `That's a lot less than usual (usually about ${typical}) — check?`;
}

/** Parse a typed amount: a finite number ≥ 0, else null. */
export function parseStockAmount(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
