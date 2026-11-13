/**
 * New orders the packing list is holding back (Graeme, 13 Nov 2026: "1 being
 * held. Come back in 15 minutes … or exactly how long"). The server hides an
 * order for its first 15 minutes while AfterSell can still add upsell items
 * (api-server lib/order-age.ts) but counts it in the day's total — so without
 * this, 53/54 with nothing to pack looks like a lost order. Pure.
 */

export interface SettlingOrder {
  orderId: number;
  name: string;
  releasesAt: string;
}

/** Whole minutes until it comes on — at least 1 while still held. */
export function minutesUntil(releasesAt: string, now: number): number {
  const ms = Date.parse(releasesAt) - now;
  return Math.max(1, Math.ceil(ms / 60_000));
}

/** "1 new order held back — on the list in 9 min" / "2 new orders held
 *  back — the first comes on in 3 min". null when nothing is held. */
export function settlingMessage(settling: readonly SettlingOrder[] | undefined, now: number): string | null {
  const still = (settling ?? []).filter(s => Date.parse(s.releasesAt) > now);
  if (still.length === 0) return null;
  const mins = minutesUntil(still[0].releasesAt, now);
  const when = `${mins} min`;
  return still.length === 1
    ? `1 new order held back — on the list in ${when}`
    : `${still.length} new orders held back — the first comes on in ${when}`;
}

/** When the screen should reload the list next: the soonest release still
 *  to come, or null. */
export function nextReleaseAt(settling: readonly SettlingOrder[] | undefined, now: number): number | null {
  const times = (settling ?? []).map(s => Date.parse(s.releasesAt)).filter(t => t > now);
  return times.length ? Math.min(...times) : null;
}
