/**
 * "New" badges. Seen is stored per PERSON (station iPads switch person with
 * a PIN), so a change stays "new" for each person until they open it, run
 * its walkthrough, or tap Got it.
 */

export function isUnseen(entry: { id: number }, seenIds: ReadonlySet<number>): boolean {
  return !seenIds.has(entry.id);
}

export function unseenCount(entries: ReadonlyArray<{ id: number }>, seenIds: ReadonlySet<number>): number {
  return entries.reduce((n, e) => n + (seenIds.has(e.id) ? 0 : 1), 0);
}

/** The text on the menu button's dot: nothing at 0, "9+" past 9. */
export function newDotLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 9 ? "9+" : String(Math.floor(count));
}

/** Unseen first (newest first within each), so what's new is on top. */
export function unseenFirst<T extends { id: number; createdAt: string }>(entries: readonly T[], seenIds: ReadonlySet<number>): T[] {
  return [...entries].sort((a, b) => {
    const ua = seenIds.has(a.id) ? 1 : 0;
    const ub = seenIds.has(b.id) ? 1 : 0;
    return ua - ub || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}
