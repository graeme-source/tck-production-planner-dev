/**
 * "Split with another supplier" — the pure rules (fix-queue #248 + #328,
 * Jane Miles; Graeme approved 22 Oct 2026). Objective C.
 *
 * Jane stock-checks blue flour once, on Monday, and orders half from Express
 * (Monday) and half from A D Maria (Tuesday). On any Orders line the person
 * ordering can move part of it to another supplier: today's supplier keeps
 * the rest, and the moved part is saved on the server and turns up on the
 * other supplier's next order day as a fixed amount.
 *
 * Shared by the API (when a split is saved, and when /orders/calculate puts
 * it on the right card) and the Orders page (the preview "This will appear
 * on A D Maria's order on Tue 6 Oct", and the stock-edit recompute), so the
 * date and the pack sums can't disagree. Nothing here knows about flour.
 */
import { isoWeekdayOf, WEEKDAY_SHORT } from "./delivery-surplus";

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The supplier fields the order-day rule reads (suppliers row). */
export type SplitSupplierDays = {
  orderFrequency: string | null;
  /** "Tuesday" or "Monday,Thursday"; empty = no set days. */
  orderDays: string | null;
};

/** ISO weekdays (1 = Mon … 7 = Sun) the supplier takes orders. A weekly
 *  supplier with set days orders on those days — the same rule
 *  /orders/calculate uses to hide it on other days; anyone else orders on
 *  any weekday (Mon–Fri). */
export function supplierOrderWeekdays(s: SplitSupplierDays): Set<number> {
  if (s.orderFrequency === "weekly" && s.orderDays) {
    const set = new Set<number>();
    for (const raw of s.orderDays.split(",")) {
      const i = WEEKDAY_NAMES.findIndex(n => n.toLowerCase() === raw.trim().toLowerCase());
      if (i >= 0) set.add(i + 1);
    }
    if (set.size > 0) return set;
  }
  return new Set([1, 2, 3, 4, 5]);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * The day a split lands on: the target supplier's next order day (from
 * today, today included) on which it hasn't ALREADY had an order placed.
 * Today counts when the supplier orders today and nothing's gone yet — the
 * part then shows on its card straight away. null if nothing within
 * `horizonDays` (a supplier with no reachable order day).
 */
export function nextSplitOrderDate(args: {
  todayIso: string;
  supplier: SplitSupplierDays;
  /** London dates (YYYY-MM-DD) the target supplier already had an order placed. */
  placedOrderDates: ReadonlySet<string>;
  horizonDays?: number;
}): string | null {
  const days = supplierOrderWeekdays(args.supplier);
  const horizon = args.horizonDays ?? 21;
  for (let i = 0; i <= horizon; i++) {
    const iso = addDaysIso(args.todayIso, i);
    if (!days.has(isoWeekdayOf(iso))) continue;
    if (args.placedOrderDates.has(iso)) continue;
    return iso;
  }
  return null;
}

/** "Tue 6 Oct" for a YYYY-MM-DD date. */
export function splitDateLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const month = dt.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return `${WEEKDAY_SHORT[isoWeekdayOf(iso)]} ${d} ${month}`;
}

/** "Split from Express Food Service, Mon" — the marker on the target line. */
export function splitFromLabel(fromSupplierName: string, fromOrderDateIso: string): string {
  return `Split from ${fromSupplierName}, ${WEEKDAY_SHORT[isoWeekdayOf(fromOrderDateIso)]}`;
}

/** Half by default, rounded down so today's supplier keeps the odd pack;
 *  at least 1 when there's anything to split. */
export function defaultSplitPacks(packs: number): number {
  const p = Math.max(0, Math.floor(Number(packs) || 0));
  if (p <= 0) return 0;
  return Math.max(1, Math.floor(p / 2));
}

/** A split amount the person can save: whole packs, at least 1, no more
 *  than the line has. Returns an error sentence, or null when fine. */
export function splitPacksProblem(packs: number, linePacks: number): string | null {
  if (!Number.isFinite(packs) || packs <= 0) return "Split at least 1 pack.";
  if (!Number.isInteger(packs)) return "Split whole packs.";
  if (packs > linePacks) return `This line only has ${linePacks} to split.`;
  return null;
}

/** Packs on a line once splits are applied: what it would order, less the
 *  packs moved AWAY to another supplier (never below 0), plus fixed packs
 *  moved IN from another supplier's order. */
export function packsAfterSplits(packs: number, awayPacks = 0, inPacks = 0): number {
  return Math.max(0, (Number(packs) || 0) - Math.max(0, Number(awayPacks) || 0)) + Math.max(0, Number(inPacks) || 0);
}
