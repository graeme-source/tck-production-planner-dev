/**
 * "I've seen this" by scrolling past (Graeme, 2026-10-01). An improvement
 * counts as seen once it has properly been on screen — at least half of it,
 * or half the screen for a tall card — for SEEN_DWELL_MS in total, and has
 * then scrolled off the TOP. Flicking past at speed never counts, and a card
 * you stop at but scroll back up from isn't "past" yet. Pure.
 */
export const SEEN_DWELL_MS = 1200;

/** Is this much of the card on screen enough to count as being looked at? */
export function isLookedAt(visibleHeight: number, cardHeight: number, viewportHeight: number): boolean {
  if (cardHeight <= 0 || viewportHeight <= 0) return false;
  return visibleHeight >= Math.min(cardHeight, viewportHeight) * 0.5;
}

/** Has the card now been read and scrolled past (its bottom above the viewport top)? */
export function scrolledPastAfterReading(dwellMs: number, cardBottom: number, viewportTop: number): boolean {
  return dwellMs >= SEEN_DWELL_MS && cardBottom <= viewportTop;
}
