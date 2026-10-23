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

// ── Against what the app EXPECTED (#327, Graeme approved 22 Oct 2026) ──────
//
// "A sense check before saving: if a count is far off what's expected (last
// count plus deliveries minus planned use), or zero straight after a
// positive count, ask 'Are you sure? We expected about 2 kg' and require a
// second tap." Expected = the running-stock ledger (GET
// /api/stock-check-expected). Counts stay blind (Graeme, 23 Oct 2026): the
// expected figure is used only to decide whether to ask — the question
// itself never shows it.

/** More than this many times the expected figure, or under 1/this of it. */
export const EXPECTED_FAR_RATIO = 2;

export type ExpectedCountSanity =
  | { level: "ok" }
  | { level: "warn"; reason: "far-off" | "zero-after-positive"; expectedNative: number };

export function expectedCountSanity(input: {
  nativeQty: number;
  /** Last count + deliveries − usage, own unit; null = never counted. */
  expectedNative: number | null | undefined;
  /** The most recent count, own unit. */
  lastCountNative: number | null | undefined;
  /** False when the app sees none of this item's usage — its expected
   *  figure only grows, so "far off" can't be judged. */
  usageTracked: boolean;
  /** One pack, own unit — a gap smaller than a pack is never questioned. */
  packWeight?: number | null;
}): ExpectedCountSanity {
  const { nativeQty } = input;
  if (!Number.isFinite(nativeQty) || nativeQty < 0) return { level: "ok" };
  const expected = input.expectedNative != null && Number.isFinite(input.expectedNative) ? input.expectedNative : null;
  const tolerance = Math.max(0, Number(input.packWeight) || 0);
  const last = input.lastCountNative ?? 0;

  // Zero straight after a positive count — unless the app itself expects
  // it to be (about) gone.
  if (nativeQty === 0 && last > 0) {
    if (expected != null && input.usageTracked && expected <= tolerance) return { level: "ok" };
    const about = expected != null && input.usageTracked && expected > 0 ? expected : last;
    return { level: "warn", reason: "zero-after-positive", expectedNative: about };
  }

  if (expected == null || !input.usageTracked || expected <= 0) return { level: "ok" };
  if (Math.abs(nativeQty - expected) <= tolerance) return { level: "ok" };
  if (nativeQty > expected * EXPECTED_FAR_RATIO || nativeQty < expected / EXPECTED_FAR_RATIO) {
    return { level: "warn", reason: "far-off", expectedNative: expected };
  }
  return { level: "ok" };
}

/** The question for a far-off or zero count. BLIND (Graeme, 23 Oct 2026:
 *  "Keep counts blind — remove the expected figure from the 'Are you sure?'
 *  check"): it never contains the expected / ledger figure, so it takes no
 *  sanity detail beyond the reason — only the person's own typed amount
 *  appears. Still needs a second tap (stock-check-entry.tsx). */
export function expectedSanityMessage(
  s: ExpectedCountSanity,
  entered: { value: number; unit: StockCheckUnit; item: StockCheckUnitItem },
): string | null {
  if (s.level !== "warn") return null;
  if (s.reason === "zero-after-positive") return "That's zero — are you sure the shelf is empty?";
  return `${formatStockCount(entered.value, entered.unit, entered.item)}? That's very different from what we'd expect — count again to be sure.`;
}

// ── Use-by on a stock check (#165, Graeme approved 22 Oct 2026) ───────────

/** Warning for a use-by entered on a count: today or already past. Null when
 *  it's later (or not a date). Compared as calendar days (YYYY-MM-DD). */
export function useByWarning(useByIso: string, todayIso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(useByIso) || !/^\d{4}-\d{2}-\d{2}/.test(todayIso)) return null;
  const today = todayIso.slice(0, 10);
  if (useByIso === today) return "Use-by is TODAY — use it today or throw it away.";
  if (useByIso < today) return "Use-by has PASSED — don't use it. Throw it away and record it as waste.";
  return null;
}
