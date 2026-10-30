/**
 * "I've seen this" without clicking (Graeme, 2026-10-01; reworked 24 Oct
 * after "I don't want to click anywhere. I just want to scroll past it onto
 * the next one"; reworked again 30 Oct). Pure rules; hooks/use-seen-on-scroll.ts
 * feeds them a sample of where the card is every time the feed scrolls and
 * a few times a second while it sits still.
 *
 * An improvement counts as seen when EITHER:
 *  - it has sat in view, read to the end, for IN_VIEW_DWELL_MS without a
 *    break (30 Oct: "If it's in view, then it's seen for enough time"). In
 *    view = its bottom edge is on screen and enough of it shows: the whole
 *    card, or for a card taller than the screen (or one partly scrolled up
 *    off the top) at least IN_VIEW_SHARE of the screen / of the card. At the
 *    very end of the feed, where the last card can't scroll any further up,
 *    END_OF_FEED_SHARE is enough. Leaving view before the time is up starts
 *    the clock again; or
 *  - it was on screen long enough to skim (LOOKING_SHARE of it for
 *    SEEN_DWELL_MS in total) and then you scrolled on past it — its bottom
 *    edge went above the top third of the scroll area.
 * Nothing counts while the tab is in the background.
 *
 * The bug this fixes (30 Oct): before, a card only counted once you'd
 * scrolled on past it, so stopping to read a card — the whole of it on
 * screen for as long as you like — did nothing until you scrolled again.
 *
 * Why it's sampled rather than event-driven: the first version waited for
 * the card to cross fully off the top edge, caught by an IntersectionObserver
 * callback. A card you'd read but only scrolled most of the way past — its
 * bottom still peeking out, or the last cards in the feed that can never
 * leave the screen — never counted, and the badge stayed up until you opened
 * it (Graeme, 16 and 24 Oct).
 */
/** Continuous time in view (bottom showing) that counts as read. */
export const IN_VIEW_DWELL_MS = 3000;
/** With its bottom on screen, how much of the card (or of the screen, for a
 *  card taller than the screen) must show for it to count as in view. */
export const IN_VIEW_SHARE = 0.5;
/** …relaxed at the very end of the feed, where the last card is stuck
 *  part-way up the screen with only its end showing. */
export const END_OF_FEED_SHARE = 0.25;
/** Skim-then-scroll-past: total time looked at before scrolling past counts. */
export const SEEN_DWELL_MS = 1000;
/** How much of the card (or of the screen, for a tall card) must show. */
export const LOOKING_SHARE = 0.45;
/** "Past" = the card's bottom is above this fraction of the scroll area. */
export const PAST_LINE = 1 / 3;

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
  /** Total time spent looked at (for the scroll-past rule). */
  dwellMs: number;
  lastAt: number | null;
  lastLooking: boolean;
  /** When the current unbroken stretch in view began, or null if not in view. */
  inViewSince: number | null;
}

export function newSeenTracker(): SeenTracker {
  return { dwellMs: 0, lastAt: null, lastLooking: false, inViewSince: null };
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

/** Is the card in view, read to its end? Its bottom edge is on screen and
 *  enough of it shows — all of a short card, or at least IN_VIEW_SHARE of
 *  the screen for a card taller than it (END_OF_FEED_SHARE once the feed
 *  can't scroll any further). */
export function isInView(s: SeenSample): boolean {
  if (s.hidden) return false;
  const cardH = s.cardBottom - s.cardTop;
  const rootH = s.rootBottom - s.rootTop;
  if (cardH <= 0 || rootH <= 0) return false;
  const bottomOnScreen = s.cardBottom <= s.rootBottom + 1 && s.cardBottom > s.rootTop;
  if (!bottomOnScreen) return false;
  const share = s.atEnd ? END_OF_FEED_SHARE : IN_VIEW_SHARE;
  return visibleHeight(s) >= Math.min(cardH, rootH) * share - 1;
}

function lookingNow(s: SeenSample): boolean {
  if (s.hidden) return false;
  return isLookedAt(visibleHeight(s), s.cardBottom - s.cardTop, s.rootBottom - s.rootTop);
}

/** Feed one sample in; get the updated tracker and whether it's now seen.
 *  Samples arrive on every scroll and every ~¼ s, so time between two
 *  samples counts as in view / looked at if the card was at the first. */
export function stepSeen(t: SeenTracker, s: SeenSample): { tracker: SeenTracker; seen: boolean } {
  const gap = t.lastAt != null && t.lastLooking ? Math.max(0, s.now - t.lastAt) : 0;
  const dwellMs = t.dwellMs + gap;
  const looking = lookingNow(s);
  const inView = isInView(s);
  const inViewSince = inView ? (t.inViewSince ?? s.now) : null;
  const seen = (inViewSince != null && s.now - inViewSince >= IN_VIEW_DWELL_MS)
    || (dwellMs >= SEEN_DWELL_MS && isScrolledPast(s.cardBottom, s.rootTop, s.rootBottom));
  return { tracker: { dwellMs, lastAt: s.now, lastLooking: looking, inViewSince }, seen };
}
