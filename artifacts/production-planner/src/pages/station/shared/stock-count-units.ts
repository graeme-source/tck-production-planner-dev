/**
 * Stock-count checks for the shared stock-check entry. Objective F.
 *
 * History: 15 Oct 2026 the entry counted FULL packs + the opened pack
 * (None / ¼ / ½ / ¾). Graeme, 19 Oct: "confusing" — replaced by the
 * two-step entry: the app says which unit the item is counted in, then one
 * number in that unit (the unit rule and the conversion to what's stored
 * live in @workspace/units stock-check-unit.ts). What stays here is the
 * "are you sure?" check, which works on the STORED (own-unit) amount, and
 * the typed-number parser.
 */
import {
  formatStockCount,
  nativeToStockCount,
  type StockCheckUnit,
  type StockCheckUnitItem,
} from "@workspace/units";

export type StockCountSanity =
  | { level: "ok" }
  | { level: "warn"; direction: "high" | "low"; basis: "recent" | "plan"; typicalNative: number };

/** Times more / fewer than the usual count before we ask "are you sure?". */
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

/** The "Are you sure — 5,500 g?" sentence for a warning, in the unit the
 *  person typed. Null when there's nothing to ask. */
export function sanityMessage(
  s: StockCountSanity,
  entered: { value: number; unit: StockCheckUnit; item: StockCheckUnitItem },
): string | null {
  if (s.level !== "warn") return null;
  const typicalCount = nativeToStockCount(s.typicalNative, entered.unit, entered.item);
  const typical = typicalCount == null
    ? null
    : formatStockCount(Math.round(typicalCount * 1000) / 1000, entered.unit, entered.item);
  const ask = `Are you sure — ${formatStockCount(entered.value, entered.unit, entered.item)}?`;
  if (typical == null) return ask;
  if (s.basis === "plan") return `${ask} That's a lot more than today's plan needs (${typical}).`;
  return s.direction === "high"
    ? `${ask} That's a lot more than usual (usually about ${typical}).`
    : `${ask} That's a lot less than usual (usually about ${typical}).`;
}

/** Parse a typed amount: a finite number ≥ 0, else null. Thousands commas
 *  ("5,500") are dropped; a lone comma is a decimal ("2,5"). */
export function parseStockAmount(raw: string): number | null {
  let t = raw.trim().replace(/\s+/g, "");
  if (t === "") return null;
  t = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
