/**
 * "Close down the packing and wrapping shift" (Graeme, 24 Nov 2026): once
 * everything is packed, everything is wrapped and the packing and wrapping
 * opening, cleaning and closing checks are all actioned, the team can close
 * the shift down. From that moment the room run rate (lib/room-kpi.ts) stops
 * counting their paid hours, so finishing early shows on the KPI and staying
 * on for improvements doesn't cost them. Nothing else changes — payroll,
 * Planday, attendance and hours-worked reports never read this.
 *
 * Pure; the data is read by services/shift-close-down.ts.
 */
import { elapsedPaidHours } from "./team-efficiency-today";
import { shiftPaidHours, type PlandayPayrollShift } from "./team-efficiency";

// ── Hours ─────────────────────────────────────────────────────────────────

/** The moment the room stops being charged: the earlier of "now" (today's
 *  live figure) and the close-down time. Both are London local
 *  "YYYY-MM-DDTHH:mm:ss". undefined = whole shifts, exactly as before. */
export function roomHoursCutoff(now: string | undefined, closedDownAt: string | undefined): string | undefined {
  if (!now) return closedDownAt;
  if (!closedDownAt) return now;
  return closedDownAt.slice(0, 19) < now.slice(0, 19) ? closedDownAt : now;
}

/** Paid hours of one shift counted up to the cutoff (unpaid breaks off, as
 *  elsewhere): a shift wholly before it counts in full, one straddling it
 *  counts up to it, one wholly after it counts nothing. No cutoff = the
 *  whole shift. */
export function paidHoursUpTo(shift: PlandayPayrollShift, cutoff: string | undefined): number {
  return cutoff ? elapsedPaidHours(shift, cutoff) : shiftPaidHours(shift);
}

// ── Eligibility ───────────────────────────────────────────────────────────

/** The two stations whose shift this closes down. Checklist station keys. */
export const CLOSE_DOWN_STATIONS = ["packing", "wrapping"] as const;
export type CloseDownStation = typeof CLOSE_DOWN_STATIONS[number];

const STATION_LABEL: Record<CloseDownStation, string> = { packing: "Packing", wrapping: "Wrapping" };
const CATEGORY_ORDER = ["opening", "cleaning", "closing"] as const;

export interface CloseDownInputs {
  /** Orders in today's despatch wave not yet packed (dispatch-progress:
   *  totalOrders − totalFulfilled). null = Shopify couldn't be read. */
  ordersToPack: number | null;
  /** Main-kitchen recipes on today's plan not yet marked wrapping complete
   *  (the wrapping station's own "All wrapped" rule). */
  recipesToWrap: number;
  /** Checklist items with no tick and no "can't do" reason
   *  (findMissingChecklistItems) — any station; only packing/wrapping count. */
  missingChecks: ReadonlyArray<{ stationType: string; category: string }>;
}

/** What's still to do, in plain words, in the order the team would see it.
 *  Empty = the shift can be closed down. */
export function closeDownOutstanding(i: CloseDownInputs): string[] {
  const out: string[] = [];
  if (i.ordersToPack == null) out.push("Can't check the orders right now — try again in a minute");
  else if (i.ordersToPack > 0) out.push(`${i.ordersToPack} order${i.ordersToPack === 1 ? "" : "s"} still to pack`);
  if (i.recipesToWrap > 0) out.push(`${i.recipesToWrap} recipe${i.recipesToWrap === 1 ? "" : "s"} still to wrap`);
  for (const station of CLOSE_DOWN_STATIONS) {
    for (const category of CATEGORY_ORDER) {
      const n = i.missingChecks.filter(m => m.stationType === station && m.category === category).length;
      if (n > 0) out.push(`${STATION_LABEL[station]} ${category} checklist: ${n} item${n === 1 ? "" : "s"} left`);
    }
  }
  return out;
}

/** Recipes still to wrap: the wrapping station's rule — every main-kitchen
 *  recipe it shows must be marked wrapping complete. Items passed in are
 *  already the station's list (main kitchen, not prep-only). */
export function recipesStillToWrap(items: ReadonlyArray<{ wrappingComplete: boolean }>): number {
  return items.filter(it => !it.wrappingComplete).length;
}
