/**
 * "I've seen this" by scrolling past (Graeme, 2026-10-01; reworked 24 Oct
 * after "I don't want to click anywhere. I just want to scroll past it onto
 * the next one"). Pure rules; hooks/use-seen-on-scroll.ts feeds them a
 * sample of where the card is every time the feed scrolls and a few times a
 * second while it sits still.
 *
 * An improvement counts as seen when BOTH:
 *  - it has been on screen long enough to read: at least LOOKING_SHARE of it
 *    (or of the screen, for a card taller than the screen) for SEEN_DWELL_MS
 *    in total — so a fast flick past never counts; and
 *  - you have moved on: its bottom edge has gone above the top third of the
 *    visible scroll area, i.e. the next card has taken over the screen.
 * Or, when the feed can't scroll any further (the last cards), once it has
 * been looked at for END_OF_FEED_DWELL_MS — there's nothing to scroll on to.
 *
 * Why it's sampled rather than event-driven: the first version waited for
 * the card to cross fully off the top edge, caught by an IntersectionObserver
 * callback. A card you'd read but only scrolled most of the way past — its
 * bottom still peeking out, or the last cards in the feed that can never
 * leave the screen — never counted, and the badge stayed up until you opened
 * it (Graeme, 16 and 24 Oct).
 */
export const SEEN_DWELL_MS = 1000;
export const END_OF_FEED_DWELL_MS = 2500;
/** How much of the card (or of the screen, for a tall card) must show. */
export const LOOKING_SHARE = 0.45;
/** "Past" = the card's bottom is above this fraction of the scroll area. */
export const PAST_LINE = 1 / 3;

/** Where the card is right now, in screen pixels. */
export interface SeenSample {
  now: number;
  cardTop: number;
  cardBottom: number;
  /** Visible scroll area (#app-main-scroll's box, or the window). */
  rootTop: number;
  rootBottom: number;
  /** The scroll area is at its very end — nothing further to scroll to. */
  atEnd: boolean;
  /** Tab in the background: nobody is reading. */
  hidden?: boolean;
}

export interface SeenTracker {
  dwellMs: number;
  lastAt: number | null;
  lastLooking: boolean;
}

export function newSeenTracker(): SeenTracker {
  return { dwellMs: 0, lastAt: null, lastLooking: false };
}

export function visibleHeight(s: Pick<SeenSample, "cardTop" | "cardBottom" | "rootTop" | "rootBottom">): number {
  return Math.max(0, Math.min(s.cardBottom, s.rootBottom) - Math.max(s.cardTop, s.rootTop));
}

/** Is this much of the card on screen enough to count as being looked at? */
export function isLookedAt(visible: number, cardHeight: number, viewportHeight: number): boolean {
  if (cardHeight <= 0 || viewportHeight <= 0) return false;
  return visible >= Math.min(cardHeight, viewportHeight) * LOOKING_SHARE;
}

/** Has the reader moved on past this card? Its bottom is above the top
 *  third of the scroll area (or gone off the top altogether). */
export function isScrolledPast(cardBottom: number, rootTop: number, rootBottom: number): boolean {
  return cardBottom <= rootTop + (rootBottom - rootTop) * PAST_LINE + 1;
}

function lookingNow(s: SeenSample): boolean {
  if (s.hidden) return false;
  const cardH = s.cardBottom - s.cardTop;
  const rootH = s.rootBottom - s.rootTop;
  const visible = visibleHeight(s);
  if (isLookedAt(visible, cardH, rootH)) return true;
  // At the very end of the feed the last card may be stuck part-way up the
  // screen with its end showing — that IS reading it; nothing else is left.
  return s.atEnd && s.cardBottom <= s.rootBottom + 1 && cardH > 0
    && visible >= Math.min(cardH, rootH) * 0.25;
}

/** Feed one sample in; get the updated tracker and whether it's now seen.
 *  Time since the previous sample counts as reading if the card was being
 *  looked at then — samples arrive on every scroll and every ~¼ s. */
export function stepSeen(t: SeenTracker, s: SeenSample): { tracker: SeenTracker; seen: boolean } {
  const gap = t.lastAt != null && t.lastLooking ? Math.max(0, s.now - t.lastAt) : 0;
  const dwellMs = t.dwellMs + gap;
  const looking = lookingNow(s);
  const seen = (dwellMs >= SEEN_DWELL_MS && isScrolledPast(s.cardBottom, s.rootTop, s.rootBottom))
    || (s.atEnd && looking && dwellMs >= END_OF_FEED_DWELL_MS);
  return { tracker: { dwellMs, lastAt: s.now, lastLooking: looking }, seen };
}
