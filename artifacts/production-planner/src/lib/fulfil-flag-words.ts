/**
 * Words for "this order should already have been fulfilled" (Graeme, 27 Nov
 * 2026 — #140447): WHEN it should have gone, how long ago, and how many
 * orders have gone since, so the packer knows where in the stack to look for
 * the box before anything is fulfilled. Pure — tested. Objective C.
 */
const TZ = "Europe/London";

const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const clock = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/** "10:19", or "Thu 10:19" when it wasn't today. */
export function whenWords(at: Date | string | number, now: Date = new Date()): string {
  const d = new Date(at);
  if (day(d) === day(now)) return clock(d);
  return `${d.toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" })} ${clock(d)}`;
}

/** "26 minutes ago", "1 h 5 min ago", "just now". */
export function agoWords(at: Date | string | number, now: Date = new Date()): string {
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `${Math.floor(h / 24)} day${h >= 48 ? "s" : ""} ago`;
  return m ? `${h} h ${m} min ago` : `${h} h ago`;
}

/** "about 3 orders ago" — null when unknown. */
export function ordersAgoWords(n: number | null | undefined): string | null {
  if (n == null) return null;
  if (n === 0) return "no orders since — it should be the last box packed";
  if (n === 1) return "1 order ago";
  return `about ${n} orders ago`;
}

/** "10:19 (26 minutes ago, about 3 orders ago)". */
export function shouldHaveGoneWords(at: Date | string | number, ordersSince: number | null | undefined, now: Date = new Date()): string {
  const parts = [agoWords(at, now), ordersAgoWords(ordersSince)].filter(Boolean);
  return `${whenWords(at, now)} (${parts.join(", ")})`;
}

/** Last 6 of a waybill — what's easy to read off a label in a stack. */
export function labelEnding(waybill: string | null | undefined): string | null {
  return waybill ? waybill.slice(-6) : null;
}
