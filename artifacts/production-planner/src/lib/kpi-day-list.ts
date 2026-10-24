/**
 * The day-by-day list under the two 30-day ROAS cards on the Numbers page
 * (Graeme, 2026-10-24: "two of these panels are 30 days, but it shows the
 * last 7 days in those pills… show the breakdown of days across the last 30
 * days… even if it's in an expandable panel"). Objective B.
 *
 * Collapsed, the list shows the newest 7 days as before; expanded, every day
 * of the card's window, newest first. Pure — the card just renders the rows.
 */

/** Rows shown while the list is collapsed. */
export const DAY_LIST_COLLAPSED_ROWS = 7;

/** Which rows to show, newest first. `points` arrive oldest first (as the
 *  sparkline draws them). */
export function visibleDayRows<T>(points: readonly T[], expanded: boolean, collapsedRows = DAY_LIST_COLLAPSED_ROWS): T[] {
  const shown = expanded ? points : points.slice(-collapsedRows);
  return [...shown].reverse();
}

/** True when there are more days than the collapsed list shows. */
export function canExpandDayList(total: number, collapsedRows = DAY_LIST_COLLAPSED_ROWS): boolean {
  return total > collapsedRows;
}

/** The expand/collapse control's label. */
export function dayListToggleLabel(expanded: boolean, total: number, collapsedRows = DAY_LIST_COLLAPSED_ROWS): string {
  return expanded ? `Show last ${collapsedRows} days` : `Show all ${total} days`;
}

/** The caption over the list, saying how much of the window is shown. */
export function dayListCaption(caption: string, expanded: boolean, total: number, collapsedRows = DAY_LIST_COLLAPSED_ROWS): string {
  if (!canExpandDayList(total, collapsedRows)) return caption;
  return expanded ? `${caption} — all ${total} days shown` : `${caption} — last ${collapsedRows} shown`;
}

/** localStorage key for one card's open/closed state. */
export const dayListStorageKey = (cardId: string) => `tck.numbers.roasDayList.${cardId}.expanded`;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const defaultStorage = (): StorageLike | null => {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
};

/** Remembered state for a card; collapsed when nothing is stored or storage
 *  is unavailable (private window, blocked site data). */
export function readDayListExpanded(cardId: string, storage: StorageLike | null = defaultStorage()): boolean {
  try { return storage?.getItem(dayListStorageKey(cardId)) === "1"; } catch { return false; }
}

export function writeDayListExpanded(cardId: string, expanded: boolean, storage: StorageLike | null = defaultStorage()): void {
  try { storage?.setItem(dayListStorageKey(cardId), expanded ? "1" : "0"); } catch { /* not remembered — fine */ }
}
