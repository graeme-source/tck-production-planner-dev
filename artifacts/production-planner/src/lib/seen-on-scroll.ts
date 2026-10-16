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

/** Has the card now been read and scrolled past?
 *
 *  `scrollTop` is the top edge, in screen pixels, of the box the card really
 *  scrolls inside. Sidebar pages scroll #app-main-scroll, which starts BELOW
 *  the top bar — not at the window's top (0). Measuring against 0 was the
 *  2026-10-16 bug (Graeme: scrolling past an improvement on the desktop
 *  didn't mark it seen): a card slides out of sight under the top bar with
 *  its bottom still somewhere between 0 and the bar's height, the observer
 *  then goes quiet because the card is fully hidden, so "bottom ≤ 0" was
 *  never seen. Small mouse-wheel steps always stop in that gap; a big touch
 *  flick could jump straight over it. */
export function scrolledPastAfterReading(dwellMs: number, cardBottom: number, scrollTop: number): boolean {
  // 1 px slack for sub-pixel layout: a card sitting exactly on the edge is past.
  return dwellMs >= SEEN_DWELL_MS && cardBottom <= scrollTop + 1;
}
