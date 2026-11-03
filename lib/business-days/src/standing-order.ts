import { ISO_WEEKDAYS, WEEKDAY_SHORT, isoWeekdayOf, type IsoWeekday } from "./delivery-surplus";

/**
 * Standing weekly orders (Fix queue #348, Graeme 3 Nov 2026). Objective C.
 *
 * "Automatically order every Friday": an ingredient or supply can carry a
 * fixed number of packs that goes on its supplier's order on chosen
 * weekdays, whether or not stock is low — so the staff-room fruit is never
 * forgotten. The team still decides: order it, or "Not today".
 *
 * These are the only rules for it — the order engine (/orders/calculate),
 * placing an order, and the Orders page's stock-edit recompute all call
 * them, so they can't drift.
 *
 * Days are London calendar days ("YYYY-MM-DD", from londonDateString on the
 * server) and ISO weekdays (1 = Mon … 7 = Sun), like surplus by delivery day.
 */

export type StandingOrderSetting = {
  /** ISO weekdays it's ordered on. Empty = off. */
  weekdays: IsoWeekday[];
  /** Fixed supplier packs. 0 = off. */
  packs: number;
};

/** What happened to a standing order on one day. */
export type StandingOrderMark = "ordered" | "skipped";

export type StandingOrderStatus =
  /** Not a chosen weekday (or the setting is off). */
  | "not_due"
  /** A chosen weekday and nobody has dealt with it yet: on the Orders page. */
  | "due"
  /** Already on a purchase order placed today. */
  | "ordered"
  /** "Not today" was pressed today. */
  | "skipped";

/** Largest fixed quantity accepted (a sanity cap, not a business rule). */
export const MAX_STANDING_ORDER_PACKS = 999;

/**
 * Read stored / sent weekdays into a clean, sorted, de-duplicated list.
 * Accepts an int[] (the column), numeric strings, or a "5,1" string.
 * Anything that isn't 1–7 is dropped.
 */
export function parseStandingWeekdays(raw: unknown): IsoWeekday[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string" ? raw.split(",") : [];
  const out = new Set<IsoWeekday>();
  for (const v of items) {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= 7) out.add(n as IsoWeekday);
  }
  return ISO_WEEKDAYS.filter(d => out.has(d));
}

/** Whole packs, 0 when blank / junk / negative, capped at the max. */
export function parseStandingPacks(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_STANDING_ORDER_PACKS, Math.round(n));
}

/** The setting from an ingredient row's two columns. */
export function standingOrderFrom(row: { standingOrderWeekdays?: unknown; standingOrderPacks?: unknown }): StandingOrderSetting {
  return {
    weekdays: parseStandingWeekdays(row.standingOrderWeekdays),
    packs: parseStandingPacks(row.standingOrderPacks),
  };
}

/** True when the setting would ever put anything on an order. */
export function standingOrderIsOn(s: StandingOrderSetting): boolean {
  return s.weekdays.length > 0 && s.packs > 0;
}

/** True when `date` (YYYY-MM-DD, London) is one of the chosen weekdays. */
export function isStandingOrderDay(s: StandingOrderSetting, date: string): boolean {
  return standingOrderIsOn(s) && s.weekdays.includes(isoWeekdayOf(date));
}

/**
 * Where a standing order stands on `date`, given that day's mark (if any).
 * A mark only counts on a chosen weekday; it never carries to another day,
 * so next week it's due again.
 */
export function standingOrderStatus(
  s: StandingOrderSetting,
  date: string,
  markForDate: StandingOrderMark | null | undefined,
): StandingOrderStatus {
  if (!isStandingOrderDay(s, date)) return "not_due";
  if (markForDate === "ordered") return "ordered";
  if (markForDate === "skipped") return "skipped";
  return "due";
}

/**
 * The standing orders to put on the Orders page on `date`: chosen weekday,
 * setting on, not yet ordered or skipped that day. `marks` is that day's
 * marks by ingredient id.
 */
export function dueStandingOrders<T extends { ingredientId: number; standingOrderWeekdays?: unknown; standingOrderPacks?: unknown }>(
  rows: readonly T[],
  date: string,
  marks: ReadonlyMap<number, StandingOrderMark>,
): Array<T & { standing: StandingOrderSetting }> {
  const out: Array<T & { standing: StandingOrderSetting }> = [];
  for (const row of rows) {
    const standing = standingOrderFrom(row);
    if (standingOrderStatus(standing, date, marks.get(row.ingredientId)) === "due") out.push({ ...row, standing });
  }
  return out;
}

/** "Every Fri", "Every Mon & Fri", "Every Mon, Wed & Fri", "Every day". */
export function standingOrderLabel(weekdays: readonly IsoWeekday[]): string {
  const days = parseStandingWeekdays(weekdays);
  if (days.length === 0) return "";
  if (days.length === 7) return "Every day";
  const names = days.map(d => WEEKDAY_SHORT[d]);
  if (names.length === 1) return `Every ${names[0]}`;
  return `Every ${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/**
 * Packs on a supplier line that also carries a standing order. The standing
 * packs are a FLOOR, not an addition: when the stock maths (or a pulled
 * kanban) already asks for more, that's ordered; otherwise the standing
 * quantity is. So a standing order never doubles a normal suggestion.
 *
 * Applied after packs split AWAY to another supplier and before fixed packs
 * split IN / queued test production, which stay on top — the same order the
 * server and the page's stock-edit recompute both use.
 *
 *   packsAfterAway — the line's packs once any split-away packs are off
 *   standingPacks  — the fixed standing quantity (0 / null = none)
 */
export function packsWithStandingFloor(packsAfterAway: number, standingPacks: number | null | undefined): number {
  const base = Math.max(0, Number(packsAfterAway) || 0);
  const floor = Math.max(0, Number(standingPacks) || 0);
  return Math.max(base, floor);
}

/**
 * Chosen weekdays the supplier doesn't take orders on — the Orders page
 * drops a weekly supplier's whole card on its other days, so a standing
 * order on one of these would never be seen. Only weekly suppliers with
 * order days set restrict anything (same rule as /orders/calculate).
 */
export function standingDaysSupplierSkips(
  weekdays: readonly IsoWeekday[],
  supplier: { orderFrequency?: string | null; orderDays?: string | null } | null | undefined,
): IsoWeekday[] {
  if (!supplier || supplier.orderFrequency !== "weekly" || !supplier.orderDays) return [];
  const names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const open = new Set<number>();
  for (const raw of supplier.orderDays.split(",")) {
    const i = names.indexOf(raw.trim().toLowerCase());
    if (i >= 0) open.add(i + 1);
  }
  if (open.size === 0) return [];
  return parseStandingWeekdays(weekdays).filter(d => !open.has(d));
}
