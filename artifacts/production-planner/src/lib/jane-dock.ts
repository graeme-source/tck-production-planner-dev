/**
 * AI Jane docked beside the page on a desktop (Graeme, 5 Nov 2026): the page
 * narrows to make room rather than being covered, like the left menu and the
 * team list dock. Below this much room she slides over the page as before: a
 * tablet or phone page can't lose this width.
 */

/** Room needed for her to sit beside the page, after any team list dock. */
export const JANE_DOCK_MIN_ROOM = 1280;
/** From here she gets her full width. */
export const JANE_DOCK_WIDE_ROOM = 1600;
export const JANE_DOCK_WIDTH = 440;
export const JANE_DOCK_WIDTH_WIDE = 500;

/** Her width when docked, or null when she should slide over the page. */
export function janeDockWidth(viewportWidth: number, teamDockWidth = 0): number | null {
  const room = viewportWidth - teamDockWidth;
  if (room < JANE_DOCK_MIN_ROOM) return null;
  return room >= JANE_DOCK_WIDE_ROOM ? JANE_DOCK_WIDTH_WIDE : JANE_DOCK_WIDTH;
}
