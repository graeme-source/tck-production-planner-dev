import { addBusinessDays } from "./index";

/**
 * Surplus by delivery day (Graeme, 14 Oct 2026). Objective C.
 *
 * An ingredient's ordering buffer can differ by the weekday its delivery
 * ARRIVES on — e.g. the Red Tractor diced chicken: 130% on Mon/Tue/Wed
 * deliveries (cover for a late or missed drop), 30% on Thu/Fri (run stock
 * down before the weekend so nothing has to be frozen). The person sets
 * the delivery day; the order day is mapped automatically from the
 * supplier's lead time — an order placed Friday for a 1-day supplier is a
 * Monday delivery, so it gets Monday's surplus.
 *
 * Every place a surplus feeds a quantity calls `surplusFor` — the order
 * suggestion on the server and the Orders page's stock-edit / delivery-date
 * recompute — so the two can never drift.
 */

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Per-delivery-weekday surplus %, keyed by ISO weekday. A missing day uses
 *  the ingredient's normal surplus. Stored as jsonb on ingredients. */
export type SurplusByDeliveryWeekday = Partial<Record<IsoWeekday, number>>;

export const ISO_WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export const WEEKDAY_SHORT: Record<IsoWeekday, string> = {
  1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun",
};

/** The fallback the order engine has always used for a blank / zero normal
 *  surplus. Kept here so behaviour without the new setting is unchanged. */
export const DEFAULT_SURPLUS_PERCENT = 10;

/** Largest % accepted for one day (a sanity cap, not a business rule). */
export const MAX_DAY_SURPLUS_PERCENT = 1000;

/**
 * Read the stored jsonb (or anything a client sent) into a clean map.
 * Keys "1"–"7"; values finite numbers 0–1000 (numeric strings accepted).
 * Blank / null / junk entries are dropped. Returns null when no day is set,
 * which means "this ingredient doesn't use the feature".
 */
export function parseSurplusByDeliveryWeekday(raw: unknown): SurplusByDeliveryWeekday | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: SurplusByDeliveryWeekday = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const day = Number(key);
    if (!Number.isInteger(day) || day < 1 || day > 7) continue;
    if (value === null || value === undefined || value === "") continue;
    const pct = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
    if (!Number.isFinite(pct) || pct < 0 || pct > MAX_DAY_SURPLUS_PERCENT) continue;
    out[day as IsoWeekday] = Math.round(pct * 100) / 100;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * ISO weekday of a delivery date. A "YYYY-MM-DD" string is read as that
 * calendar day; a Date uses its local weekday — the same clock
 * `addBusinessDays` / `calcExpectedDeliveryDate` count on, so the weekday
 * always matches the date the Orders page shows.
 */
export function isoWeekdayOf(date: Date | string): IsoWeekday {
  let jsDay: number;
  if (typeof date === "string") {
    const [y, m, d] = date.slice(0, 10).split("-").map(Number);
    jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  } else {
    jsDay = date.getDay();
  }
  return (jsDay === 0 ? 7 : jsDay) as IsoWeekday;
}

/** The surplus-relevant slice of an ingredient row. */
export type SurplusSettings = {
  surplusMode?: string | null;
  surplusPercent?: number | string | null;
  surplusAbsoluteQty?: number | string | null;
  surplusByDeliveryWeekday?: unknown;
};

export type SurplusResult = {
  /** Buffer quantity in the ingredient's native unit. */
  qty: number;
  mode: "percent" | "absolute";
  /** The % applied (null in absolute mode). */
  percent: number | null;
  /** The ingredient's normal %, for "normally 30%" explanations. */
  basePercent: number;
  /** Weekday of the delivery the surplus was worked out for (null = no date). */
  deliveryWeekday: IsoWeekday | null;
  /** True when a delivery-day % (not the normal %) was used. */
  fromDeliveryDay: boolean;
};

/**
 * THE surplus rule. Percent mode: % of daily requirement, where the % is the
 * delivery weekday's own setting when it has one, else the normal %.
 * Absolute mode: the fixed quantity (delivery-day % never applies — it is a
 * % of usage). No delivery-day setting → exactly the old formula.
 */
export function surplusFor(
  ingredient: SurplusSettings,
  deliveryDate: Date | string | null | undefined,
  dailyRequirement: number,
): SurplusResult {
  const basePercent = Number(ingredient.surplusPercent) || DEFAULT_SURPLUS_PERCENT;
  const deliveryWeekday = deliveryDate ? isoWeekdayOf(deliveryDate) : null;
  if (ingredient.surplusMode === "absolute") {
    const abs = ingredient.surplusAbsoluteQty != null ? Number(ingredient.surplusAbsoluteQty) : 0;
    return {
      qty: Math.max(0, Number.isFinite(abs) ? abs : 0),
      mode: "absolute",
      percent: null,
      basePercent,
      deliveryWeekday,
      fromDeliveryDay: false,
    };
  }
  const byDay = parseSurplusByDeliveryWeekday(ingredient.surplusByDeliveryWeekday);
  const dayPercent = byDay && deliveryWeekday ? byDay[deliveryWeekday] : undefined;
  const percent = dayPercent ?? basePercent;
  const daily = Number.isFinite(dailyRequirement) ? dailyRequirement : 0;
  return {
    qty: daily * (percent / 100),
    mode: "percent",
    percent,
    basePercent,
    deliveryWeekday,
    fromDeliveryDay: dayPercent !== undefined,
  };
}

/** "Surplus 130% (delivery Tue)" / "Surplus 10%" / "Fixed surplus". */
export function surplusLabel(r: Pick<SurplusResult, "mode" | "percent" | "deliveryWeekday" | "fromDeliveryDay">): string {
  if (r.mode === "absolute") return "Fixed surplus";
  const pct = `${r.percent ?? 0}%`;
  if (r.fromDeliveryDay && r.deliveryWeekday) return `Surplus ${pct} (delivery ${WEEKDAY_SHORT[r.deliveryWeekday]})`;
  return `Surplus ${pct}`;
}

/**
 * Which delivery weekday an order placed on each working day lands on, for a
 * supplier with this lead time, ordering before its cut-off. Uses the same
 * business-day counting as `calcExpectedDeliveryDate`, so the preview the
 * settings show is the mapping the order engine applies.
 */
export function orderToDeliveryWeekdays(leadTimeDays = 1): Array<{ orderWeekday: IsoWeekday; deliveryWeekday: IsoWeekday }> {
  const lead = Number.isFinite(leadTimeDays) && leadTimeDays > 0 ? Math.floor(leadTimeDays) : 1;
  // Monday 5 Jan 2026, mid-morning local — any Monday works.
  const monday = new Date(2026, 0, 5, 10, 0, 0);
  const out: Array<{ orderWeekday: IsoWeekday; deliveryWeekday: IsoWeekday }> = [];
  for (let i = 0; i < 5; i++) {
    const orderDay = new Date(monday);
    orderDay.setDate(monday.getDate() + i);
    out.push({ orderWeekday: isoWeekdayOf(orderDay), deliveryWeekday: isoWeekdayOf(addBusinessDays(orderDay, lead)) });
  }
  return out;
}

export type DeliverySurplusPreviewRow = {
  orderWeekday: IsoWeekday;
  deliveryWeekday: IsoWeekday;
  percent: number;
  fromDeliveryDay: boolean;
};

/** One row per working order day, sorted by delivery day (Mon first). */
export function deliverySurplusPreview(
  ingredient: Pick<SurplusSettings, "surplusPercent" | "surplusByDeliveryWeekday">,
  leadTimeDays = 1,
): DeliverySurplusPreviewRow[] {
  const byDay = parseSurplusByDeliveryWeekday(ingredient.surplusByDeliveryWeekday);
  const base = Number(ingredient.surplusPercent) || DEFAULT_SURPLUS_PERCENT;
  return orderToDeliveryWeekdays(leadTimeDays)
    .map(({ orderWeekday, deliveryWeekday }) => {
      const day = byDay?.[deliveryWeekday];
      return { orderWeekday, deliveryWeekday, percent: day ?? base, fromDeliveryDay: day !== undefined };
    })
    .sort((a, b) => a.deliveryWeekday - b.deliveryWeekday || a.orderWeekday - b.orderWeekday);
}

/** "Orders placed Fri → delivered Mon: 130% · Mon → Tue: 130% · …" */
export function describeDeliverySurplus(rows: DeliverySurplusPreviewRow[]): string {
  return rows
    .map((r, i) => `${i === 0 ? "Orders placed " : ""}${WEEKDAY_SHORT[r.orderWeekday]} → ${i === 0 ? "delivered " : ""}${WEEKDAY_SHORT[r.deliveryWeekday]}: ${r.percent}%`)
    .join(" · ");
}

/** Delivery weekdays no working-day order reaches for this lead time
 *  (Sat/Sun for every supplier today) — a % there is never used. */
export function unreachableDeliveryWeekdays(leadTimeDays = 1): IsoWeekday[] {
  const reached = new Set(orderToDeliveryWeekdays(leadTimeDays).map(r => r.deliveryWeekday));
  return ISO_WEEKDAYS.filter(d => !reached.has(d));
}
