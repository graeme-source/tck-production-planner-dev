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
