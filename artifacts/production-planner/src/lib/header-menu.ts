/**
 * The phone top bar's single menu button (Graeme, 2026-10-10; Objective F):
 * on a phone the bell, Messages, SOPs, + SOP and the name pill no longer
 * fit, so they live behind one button whose badge says something is
 * waiting. Pure; tested in header-menu.test.ts.
 */

/** Below this width (Tailwind's md) the top bar folds into the menu. */
export const PHONE_HEADER_MAX_PX = 767;

export function isPhoneHeader(viewportWidth: number): boolean {
  return viewportWidth <= PHONE_HEADER_MAX_PX;
}

/**
 * The badge on the menu button: unread notifications plus unread messages,
 * "!" when a message is waiting to be confirmed but nothing is unread, and
 * nothing at all when there's nothing new.
 */
export function headerMenuBadge(o: { notifications: number; messages: number; messageWaiting: boolean }): string | null {
  const n = Math.max(0, o.notifications) + Math.max(0, o.messages);
  if (n > 0) return n > 99 ? "99+" : String(n);
  return o.messageWaiting ? "!" : null;
}
