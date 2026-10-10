/**
 * Swipe-from-the-side gestures (Graeme, 2026-10-10; Objectives F and H).
 * Pure; tested in edge-swipe.test.ts. The DOM wiring is
 * hooks/use-side-swipe.ts.
 *
 *   - RIGHT half, swiped right-to-left: pulls out the quick-actions panel,
 *     like the iPhone's notification centre. It doesn't have to start on
 *     the handle — anywhere in the right half, any height.
 *   - LEFT half, swiped left-to-right: takes the founder to The Business
 *     (founder only, on touch screens, where it's no longer in the menu).
 *
 * Guard rails, so it never fires by accident or steals another gesture:
 *   - never within EDGE_GUARD_PX of the very edge (Safari keeps those for
 *     back / forward);
 *   - it must be clearly sideways (more than twice as far across as up or
 *     down) and travel SWIPE_SLOP_PX before anything moves;
 *   - never from inside a text box, slider, canvas, drag-and-drop area,
 *     sideways-scrolling table or anything marked data-no-swipe;
 *   - never over another pop-up or the PIN lock (checked by the caller).
 */

/** Safari's back/forward swipe lives within this many px of the edge. */
export const EDGE_GUARD_PX = 20;
/** How far the finger must travel before the gesture is "ours". */
export const SWIPE_SLOP_PX = 24;
/** Sideways must beat up/down by this factor. */
export const HORIZONTAL_RATIO = 2;

export type Side = "left" | "right";

/** Can a side swipe start at this x? The half of the screen, minus the edge. */
export function inStartZone(side: Side, x: number, viewportWidth: number): boolean {
  if (!(viewportWidth > 0)) return false;
  if (side === "right") return x >= viewportWidth / 2 && x <= viewportWidth - EDGE_GUARD_PX;
  return x <= viewportWidth / 2 && x >= EDGE_GUARD_PX;
}

export type MoveVerdict = "pending" | "go" | "abandon";

/**
 * After the finger has moved (dx, dy) from where it went down, is this our
 * sideways swipe yet? `direction` is -1 for right-to-left, +1 for
 * left-to-right, 0 for either. "abandon" = it's a scroll or the wrong way:
 * let the page have it and stop watching.
 */
export function classifyMove(o: {
  dx: number;
  dy: number;
  direction: -1 | 0 | 1;
  slopPx?: number;
  ratio?: number;
}): MoveVerdict {
  const slop = o.slopPx ?? SWIPE_SLOP_PX;
  const ratio = o.ratio ?? HORIZONTAL_RATIO;
  const ax = Math.abs(o.dx);
  const ay = Math.abs(o.dy);
  if (ax < slop && ay < slop) return "pending";
  // Past the slop: it's ours only if it's clearly sideways AND the right way.
  // Anything else (a scroll, a diagonal, the wrong way) belongs to the page.
  if (ax > ratio * ay && (o.direction === 0 || Math.sign(o.dx) === o.direction)) return "go";
  return "abandon";
}

/** What we know about one element on the way up from where the finger went down. */
export interface AncestorInfo {
  tag: string;
  /** Attributes that matter: data-no-swipe, contenteditable, draggable, role,
   *  aria-roledescription, type (for <input>). */
  attrs: Record<string, string | null | undefined>;
  /** Computed overflow-x. */
  overflowX?: string;
  /** How much wider the content is than the box, px (scrollWidth − clientWidth). */
  sidewaysSlackPx?: number;
}

/**
 * A box only counts as sideways-scrolling when it can scroll a real
 * distance. A page whose content pokes a few px past the screen edge (seen
 * on the phone dashboard, 11 px) mustn't switch the swipe off everywhere —
 * and CSS can't tell us which boxes were meant to scroll sideways, because
 * overflow-y: auto forces overflow-x to auto as well.
 */
export const SIDEWAYS_SCROLL_MIN_PX = 32;

const BLOCK_TAGS = new Set(["input", "textarea", "select", "canvas", "video", "iframe"]);

/**
 * Does anything between the touched element and the page (nearest first)
 * own sideways gestures itself? Then a side swipe must leave it alone.
 */
export function blockedByAncestors(chain: AncestorInfo[]): boolean {
  for (const a of chain) {
    const tag = a.tag.toLowerCase();
    if (BLOCK_TAGS.has(tag)) return true;
    const at = a.attrs;
    if (at["data-no-swipe"] != null) return true;
    const ce = at["contenteditable"];
    if (ce != null && ce !== "false") return true;
    if (at["draggable"] === "true") return true;
    if (at["role"] === "slider") return true;
    // dnd-kit marks what it can drag.
    const rd = at["aria-roledescription"];
    if (rd === "draggable" || rd === "sortable") return true;
    if ((a.overflowX === "auto" || a.overflowX === "scroll") && (a.sidewaysSlackPx ?? 0) >= SIDEWAYS_SCROLL_MIN_PX) return true;
  }
  return false;
}

/**
 * The founder's left swipe: far enough to go to The Business? A deliberate
 * swipe — 30% of the screen (at least 120 px) — or a fast flick that has
 * still covered 20%.
 */
export const LEFT_SWIPE_SHARE = 0.3;
export const LEFT_SWIPE_MIN_PX = 120;
export const LEFT_FLICK_SHARE = 0.2;

export function leftSwipeCommits(o: { dx: number; viewportWidth: number; velocityPxPerMs: number; flickPxPerMs?: number }): boolean {
  if (o.dx <= 0) return false;
  const need = Math.max(LEFT_SWIPE_MIN_PX, o.viewportWidth * LEFT_SWIPE_SHARE);
  if (o.dx >= need) return true;
  const flick = o.flickPxPerMs ?? 0.5;
  return o.velocityPxPerMs >= flick && o.dx >= o.viewportWidth * LEFT_FLICK_SHARE;
}

/**
 * The Business in the menu? On a touch screen (iPad, phone) the founder
 * reaches it by swiping from the left instead, so it comes out of the menu
 * there; with a mouse it stays. Anyone else Graeme has granted a Business
 * tab keeps the menu entry everywhere — the swipe is his alone.
 * "Touch screen" is decided by the pointer, not the width: iPad landscape
 * is as wide as a laptop.
 */
export function isTouchPrimary(o: { coarsePointer: boolean; canHover: boolean }): boolean {
  return o.coarsePointer || !o.canHover;
}

export function showBusinessInNav(o: { isFounder: boolean; coarsePointer: boolean; canHover: boolean }): boolean {
  if (!o.isFounder) return true;
  return !isTouchPrimary(o);
}

/** Does the founder's left swipe work here? Only where the menu entry is hidden. */
export function businessSwipeEnabled(o: { isFounder: boolean; coarsePointer: boolean; canHover: boolean; onBusinessPage: boolean }): boolean {
  return o.isFounder && isTouchPrimary(o) && !o.onBusinessPage;
}
