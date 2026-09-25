/**
 * App scrolling happens in one of two places: sidebar pages scroll the
 * layout's main container (#app-main-scroll, set in components/layout.tsx),
 * full-screen pages (stations, meeting) scroll the window. These helpers
 * pick the right one so pages don't need to know which world they're in.
 */

export function appScrollContainer(): HTMLElement | null {
  return document.getElementById("app-main-scroll");
}

/** Jump to the top — used when a page swaps to a full-screen sub-view (an
 *  improvement's detail, a log form) so it never opens mid-scroll. */
export function scrollAppToTop() {
  const el = appScrollContainer();
  if (el) el.scrollTop = 0;
  else window.scrollTo({ top: 0 });
}

/** The bits of an element resetScrollWithin touches — narrow so it's testable
 *  without a DOM. */
export interface ScrollableLike {
  scrollTop: number;
  querySelectorAll?: (selector: string) => ArrayLike<ScrollableLike>;
}

/** Put a scroll area and every scrollable thing inside it back at the top.
 *  The meeting deck keeps ONE slide-body element across slides, and React
 *  reuses a slide's inner elements when two slides of the same kind sit side
 *  by side, so without this the next slide opens wherever the last one was
 *  scrolled to (Graeme, 2026-09-25). */
export function resetScrollWithin(root: ScrollableLike | null | undefined) {
  if (!root) return;
  root.scrollTop = 0;
  const inner = root.querySelectorAll?.("*");
  if (!inner) return;
  for (let i = 0; i < inner.length; i++) {
    const el = inner[i]!;
    if (el.scrollTop > 0) el.scrollTop = 0;
  }
}
