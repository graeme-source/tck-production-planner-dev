/**
 * Supplier order cut-offs on the Orders page (Objective C — never run out).
 *
 * Every supplier has a daily cut-off ("order by 4pm for the normal lead
 * time"). Graeme, 2026-10-01: the supplier with the soonest cut-off should
 * always be at the top of the To Order list, and each card should say how
 * long is left — "Cut-off 4pm · order within 35 min".
 *
 * Everything here is pure and works on the Europe/London wall clock, never
 * the browser's offset, so an iPad set to the wrong zone (or a winter/summer
 * changeover) can't move the deadline.
 *
 * Whether a cut-off counts TODAY follows the same rules the order maths uses:
 *   • weekends have no cut-off (calcExpectedDeliveryDate counts working days
 *     only) unless a weekly supplier's order days include that weekend day;
 *   • a weekly supplier (orderFrequency "weekly" + orderDays) only has a
 *     deadline on its order days — the same rule /api/orders/calculate uses
 *     to drop it on other days.
 */

export type SupplierCutoffInfo = {
  cutoffTime?: string | null;
  orderFrequency?: string | null;
  /** Comma-separated full weekday names, e.g. "Monday,Thursday". */
  orderDays?: string | null;
};

export type CutoffUrgency = "calm" | "soon" | "urgent";

export type CutoffStatus =
  /** Cut-off still ahead today. */
  | { kind: "open"; cutoffMinutes: number; msLeft: number; urgency: CutoffUrgency }
  /** No deadline today: no cut-off set, a weekend, or not a weekly order day. */
  | { kind: "none"; reason: "no-cutoff" | "weekend" | "not-order-day"; cutoffMinutes: number | null; orderDays: string[] }
  /** Today's cut-off has gone — ordering now means the later delivery. */
  | { kind: "passed"; cutoffMinutes: number };

/** Within this, the card turns amber. */
export const SOON_MS = 2 * 60 * 60 * 1000;
/** Within this, the card turns red. */
export const URGENT_MS = 30 * 60 * 1000;
/** Within this, the countdown shows seconds. */
export const FINAL_MS = 10 * 60 * 1000;

const LONDON_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Weekday name and time-of-day (ms since London midnight) of a moment. */
export function londonClock(now: Date): { weekday: string; msOfDay: number } {
  const parts = LONDON_PARTS.formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "0";
  const h = Number(get("hour")) % 24;
  const m = Number(get("minute"));
  const s = Number(get("second"));
  const msOfDay = ((h * 60 + m) * 60 + s) * 1000 + now.getMilliseconds();
  return { weekday: get("weekday"), msOfDay };
}

/** "16:00" → 960. Anything unparseable → null (treated as no cut-off). */
export function parseCutoff(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(raw);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function parseOrderDays(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map(d => d.trim()).filter(Boolean);
}

/** Where a supplier stands against its cut-off at `now`. */
export function cutoffStatus(info: SupplierCutoffInfo, now: Date): CutoffStatus {
  const cutoffMinutes = parseCutoff(info.cutoffTime);
  const { weekday, msOfDay } = londonClock(now);
  const weekly = info.orderFrequency === "weekly";
  const orderDays = weekly ? parseOrderDays(info.orderDays) : [];

  if (cutoffMinutes == null) return { kind: "none", reason: "no-cutoff", cutoffMinutes: null, orderDays };

  const isWeekend = weekday === "Saturday" || weekday === "Sunday";
  if (orderDays.length > 0) {
    // A weekly supplier's own order days decide — including a weekend day
    // if that's genuinely when they take orders.
    if (!orderDays.includes(weekday)) return { kind: "none", reason: "not-order-day", cutoffMinutes, orderDays };
  } else if (isWeekend) {
    return { kind: "none", reason: "weekend", cutoffMinutes, orderDays };
  }

  const msLeft = cutoffMinutes * 60_000 - msOfDay;
  if (msLeft <= 0) return { kind: "passed", cutoffMinutes };
  const urgency: CutoffUrgency = msLeft <= URGENT_MS ? "urgent" : msLeft <= SOON_MS ? "soon" : "calm";
  return { kind: "open", cutoffMinutes, msLeft, urgency };
}

/** Sort bucket: 0 = cut-off ahead today, 1 = no deadline today, 2 = passed. */
export function cutoffGroup(s: CutoffStatus): 0 | 1 | 2 {
  return s.kind === "open" ? 0 : s.kind === "none" ? 1 : 2;
}

/** Soonest deadline first; ties keep their existing order (stable sort). */
export function compareCutoff(a: CutoffStatus, b: CutoffStatus): number {
  const g = cutoffGroup(a) - cutoffGroup(b);
  if (g !== 0) return g;
  if (a.kind === "open" && b.kind === "open") return a.msLeft - b.msLeft;
  return 0;
}

/** Stable sort of cards by cut-off urgency. Does not mutate `items`. */
export function sortByCutoff<T>(items: readonly T[], statusOf: (item: T) => CutoffStatus): T[] {
  return items
    .map((item, i) => ({ item, i, s: statusOf(item) }))
    .sort((a, b) => compareCutoff(a.s, b.s) || a.i - b.i)
    .map(x => x.item);
}

/** 960 → "4pm", 990 → "4:30pm", 720 → "12pm", 0 → "12am". */
export function formatCutoffTime(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

/**
 * Time left, rounded DOWN so the screen never promises more time than there
 * is: "2 h 05 min", "35 min", and in the final 10 minutes "9 min 42 s".
 */
export function formatTimeLeft(msLeft: number): string {
  const totalSec = Math.max(0, Math.floor(msLeft / 1000));
  if (msLeft <= FINAL_MS) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
  }
  const totalMin = Math.floor(totalSec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

function shortDays(days: string[]): string {
  return days.map(d => d.slice(0, 3)).join(" & ");
}

/**
 * The words on the card. `deliveryText` is the already-resolved delivery
 * date for an order placed now (same resolver the Place Order button uses).
 */
export function cutoffLabel(s: CutoffStatus, deliveryText?: string): string {
  switch (s.kind) {
    case "open":
      return `Cut-off ${formatCutoffTime(s.cutoffMinutes)} · order within ${formatTimeLeft(s.msLeft)}`;
    case "passed":
      return deliveryText
        ? `Cut-off ${formatCutoffTime(s.cutoffMinutes)} passed — ordering now arrives ${deliveryText}`
        : `Cut-off ${formatCutoffTime(s.cutoffMinutes)} passed`;
    case "none":
      if (s.reason === "no-cutoff") return "No cut-off time set";
      if (s.reason === "not-order-day") return `Orders on ${shortDays(s.orderDays)} only — no cut-off today`;
      return "No cut-off today (weekend)";
  }
}

/** How often the countdown should refresh: every second near the end. */
export function tickIntervalMs(s: CutoffStatus): number {
  if (s.kind !== "open") return 60_000;
  return s.msLeft <= FINAL_MS + 30_000 ? 1_000 : 30_000;
}
