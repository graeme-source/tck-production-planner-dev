// ── Who gets the "Stock check required" pop-up ─────────────────────────────
//
// One rule for every prep station that forces a count when an item is
// finished: Main Prep since the start, Raw Meat Prep from issue #360 (Jane,
// 27 Oct: "all raw stock check doesn't automatically pop up like fresh veg
// does").
//
// An item pops up when its stock check is due today, every tin/tray is
// actually ticked (deferred-only items haven't been used, so stock hasn't
// moved), no count is saved yet, and the person hasn't skipped it. It only
// pops for the person who ticked the LAST tin/tray — everyone else on the
// station keeps working; the Stock Check tab still lists every pending count.
// Nothing pops until the saved counts have loaded at least once, so opening
// the station never flashes pop-ups for items already counted.

export interface ForcedStockCheckCandidate {
  ingredientId: number;
  /** Stock check switched on and due today (daily, or today's weekly day). */
  dueToday: boolean;
  /** Every tin/tray ticked (not just deferred). */
  allTicked: boolean;
  /** A count is saved on the server for the check date. */
  counted: boolean;
  /** Who ticked the most recent tin/tray of this item. */
  lastTickedByUserId: number | null;
}

export function pendingForcedStockChecks<T extends ForcedStockCheckCandidate>(
  items: T[],
  opts: { currentUserId: number | null; countsLoaded: boolean; skippedIds: ReadonlySet<number> },
): T[] {
  if (!opts.countsLoaded || opts.currentUserId == null) return [];
  return items.filter(i =>
    i.dueToday && i.allTicked && !i.counted
    && !opts.skippedIds.has(i.ingredientId)
    && i.lastTickedByUserId === opts.currentUserId,
  );
}
