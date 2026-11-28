/**
 * The Business as a row of pages you swipe through, like the iPhone home
 * screen (Graeme, 28 Nov 2026; Objective I). TOUCH SCREENS ONLY — with a
 * mouse the strip and the pages stay exactly as they were.
 *
 *   - The pages are the Business tab strip, in its own order. On a touch
 *     screen an "Orders" page (the Every order table) comes first, just to
 *     the left of Numbers; opening The Business still lands on Numbers.
 *   - Drag sideways anywhere on the page: the page follows the finger one
 *     for one and the neighbour slides in beside it. Past either end it
 *     resists (a rubber band) and springs back.
 *   - Let go: it pages if it has gone PAGE_SHARE of the way, or on a flick
 *     in that direction that has still travelled FLICK_MIN_SHARE; a flick
 *     back the other way cancels. Then an eased slide that starts at the
 *     finger's own speed.
 *
 * Pure; tested in business-pager.test.ts. The DOM side is
 * components/business-swipe.tsx (it also carries the founder's swipe INTO
 * The Business from anywhere else, which slides the same way).
 */

export interface NavTab {
  href: string;
  label: string;
}

export const ORDERS_TAB: NavTab = { href: "/founder/orders", label: "Orders" };
export const NUMBERS_HREF = "/founder/numbers";

/**
 * The strip as this person sees it. On a touch screen, whoever can open
 * Numbers also gets Orders, first. With a mouse it's the strip unchanged.
 */
export function businessNavTabs(o: { tabs: readonly NavTab[]; canNumbers: boolean; touchPrimary: boolean }): NavTab[] {
  const tabs = o.tabs.map(t => ({ href: t.href, label: t.label }));
  if (!o.touchPrimary || !o.canNumbers) return tabs;
  if (tabs.some(t => t.href === ORDERS_TAB.href)) return tabs;
  return [{ ...ORDERS_TAB }, ...tabs];
}

/** Where this page sits in the row, and who's either side. null = not a page of the row. */
export function pagerNeighbours(hrefs: readonly string[], current: string): { index: number; prev: string | null; next: string | null } | null {
  if (hrefs.length < 2) return null;
  const index = hrefs.indexOf(current);
  if (index < 0) return null;
  return { index, prev: hrefs[index - 1] ?? null, next: hrefs[index + 1] ?? null };
}

/**
 * iOS-style rubber band: the further past the end, the less it gives.
 * `overshoot` px of finger travel → that many px of movement, never more
 * than `dimension` × 0.55 or so.
 */
export function rubberBand(overshoot: number, dimension: number, coefficient = 0.55): number {
  if (!(dimension > 0) || overshoot === 0) return 0;
  const sign = Math.sign(overshoot);
  const x = Math.abs(overshoot);
  return sign * (1 - 1 / ((x * coefficient) / dimension + 1)) * dimension;
}

/**
 * How far the page moves for a finger travel of dx (positive = to the
 * right, revealing the page on the LEFT). One for one while there's a page
 * that way; a rubber band where there isn't. Never more than a page.
 */
export function pagerFollow(dx: number, o: { width: number; hasPrev: boolean; hasNext: boolean }): number {
  if (!(o.width > 0)) return 0;
  const open = dx > 0 ? o.hasPrev : o.hasNext;
  const moved = open ? dx : rubberBand(dx, o.width);
  return Math.max(-o.width, Math.min(o.width, moved));
}

/** Share of the page that must be dragged across to turn it. */
export const PAGE_SHARE = 0.4;
/** A release at least this fast (px per ms, ~400 px/s) is a flick… */
export const PAGE_FLICK_PX_PER_MS = 0.4;
/** …and a flick turns the page once it has gone this share. */
export const FLICK_MIN_SHARE = 0.1;

export type PagerResult = "prev" | "next" | "stay";

/** On release: turn to the page on the left, the right, or spring back. */
export function pagerSnap(o: { dx: number; velocityPxPerMs: number; width: number; hasPrev: boolean; hasNext: boolean }): PagerResult {
  if (!(o.width > 0) || o.dx === 0) return "stay";
  const toward = o.dx > 0 ? "prev" : "next";
  if (toward === "prev" ? !o.hasPrev : !o.hasNext) return "stay";
  const share = Math.abs(o.dx) / o.width;
  const v = o.velocityPxPerMs;
  const flickToward = Math.sign(v) === Math.sign(o.dx) && Math.abs(v) >= PAGE_FLICK_PX_PER_MS;
  const flickBack = Math.sign(v) === -Math.sign(o.dx) && Math.abs(v) >= PAGE_FLICK_PX_PER_MS;
  if (flickBack) return "stay";
  if (share >= PAGE_SHARE) return toward;
  if (flickToward && share >= FLICK_MIN_SHARE) return toward;
  return "stay";
}

/**
 * The slide after letting go: decelerates (ease-out), like iOS. After a
 * flick it lasts 2 × distance ÷ the finger's speed, so it carries on at
 * about the finger's pace (a touch quicker) and eases to a stop; kept
 * between MIN and MAX so a slow release still settles promptly and a hard
 * flick doesn't snap.
 */
export const SETTLE_EASING = "cubic-bezier(0.25, 1, 0.5, 1)";
export const SETTLE_MIN_MS = 180;
export const SETTLE_MAX_MS = 420;

export function settleDurationMs(o: { fromPx: number; toPx: number; velocityPxPerMs: number; width: number }): number {
  const remaining = Math.abs(o.toPx - o.fromPx);
  if (remaining < 1) return 0;
  const clamp = (n: number) => Math.round(Math.min(SETTLE_MAX_MS, Math.max(SETTLE_MIN_MS, n)));
  const heading = Math.sign(o.toPx - o.fromPx);
  const speed = Math.sign(o.velocityPxPerMs) === heading ? Math.abs(o.velocityPxPerMs) : 0;
  if (speed >= 0.3) return clamp((2 * remaining) / speed);
  const share = o.width > 0 ? Math.min(1, remaining / o.width) : 1;
  return clamp(240 + 160 * share);
}

/**
 * The founder's swipe INTO The Business from another page: the page
 * follows the finger to the right (never left), at most a full width.
 */
export function intoBusinessFollow(dx: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.max(0, Math.min(width, dx));
}
