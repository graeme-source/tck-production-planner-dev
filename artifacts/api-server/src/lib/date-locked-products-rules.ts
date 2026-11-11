/**
 * Products whose delivery date must not be changed without a person
 * (Graeme, 11 Nov 2026). Objective C. Pure — tested alongside.
 *
 * Test production is made to order for one delivery (this week's Chicken &
 * Bacon Pie, Beef & Mushroom, Sausage & Chutney and the gravy pot — none of
 * them named "test"), so moving the order to another day, earlier or later,
 * may leave nothing to send. 8-pack bags are made to order too. Any order
 * holding one of these is a manual date change: the Friday dispatch check
 * won't reschedule it, and the website assistant won't move it (it reads
 * this list from GET /api/public/date-locked-products).
 */

/** Recently or soon made as test production: this many days back still counts. */
export const TEST_PRODUCTION_LOOKBACK_DAYS = 14;

/** Lower-case substrings that lock a line by its product or variant title. */
export const LOCKED_TITLE_PATTERNS = ["8 pack bag", "test box", "test pack"] as const;

export interface DateLockedProducts {
  variantIds: string[];
  titlePatterns: string[];
}

export interface LockableLine {
  variant_id?: number | string | null;
  title?: string | null;
  variant_title?: string | null;
  /** Removed by an order edit when 0 — such lines don't count. */
  current_quantity?: number | null;
}

/** The lines that lock the order's date (empty = it can be moved). */
export function lockedLines<T extends LockableLine>(lines: readonly T[] | null | undefined, locked: DateLockedProducts): T[] {
  const ids = new Set(locked.variantIds.map(String));
  const patterns = locked.titlePatterns.map(p => p.toLowerCase()).filter(Boolean);
  return (lines ?? []).filter(l => {
    if (l.current_quantity === 0) return false;
    if (l.variant_id != null && ids.has(String(l.variant_id))) return true;
    const hay = `${l.title ?? ""} ${l.variant_title ?? ""}`.toLowerCase();
    return patterns.some(p => hay.includes(p));
  });
}

/** One plain line saying why, for the Friday check card. */
export function lockedReason<T extends LockableLine>(lines: readonly T[]): string | null {
  if (lines.length === 0) return null;
  const names = [...new Set(lines.map(l => [l.title, l.variant_title].filter(Boolean).join(" – ")))];
  const bag = lines.some(l => `${l.title ?? ""} ${l.variant_title ?? ""}`.toLowerCase().includes("8 pack bag"));
  const what = bag && lines.every(l => `${l.title ?? ""} ${l.variant_title ?? ""}`.toLowerCase().includes("8 pack bag"))
    ? "8-pack bags are made to order"
    : "Has products made to order for this date";
  return `${what} (${names.join(", ")}) — change the date by hand.`;
}
