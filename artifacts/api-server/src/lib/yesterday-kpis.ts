/**
 * Shared yesterday-KPI helpers used by the morning-meeting dashboard
 * and (eventually) the Analytics page. Extracted so the morning
 * meeting reports the same numbers operators see in Analytics —
 * before this, the meeting was doing simpler raw-wallclock maths
 * (no break subtraction) and reading local batch_completions for
 * packing (which is empty because packing speed is computed from
 * Shopify fulfillment timestamps, not local completions).
 *
 * The two functions below mirror the calculations already trusted
 * inside /api/reports/production-kpis (builder BPH) and
 * /api/reports/packing-speed (orders/hr). Pure-function shape — no
 * Express req/res, no caching — so they're cheap to call from
 * anywhere.
 */
import { db, improvementSubmissionsTable } from "@workspace/db";
import { and, inArray, isNotNull } from "drizzle-orm";
import { londonStartOfDay, londonEndOfDay } from "./london-time";
import {
  countImprovementsCompletedInWindow,
  IMPROVEMENT_DONE_STATUSES,
} from "./improvements-completed";
import { getOrdersByTag } from "../services/shopify";
import { teamRunRateForDates } from "../services/team-run-rate";

/**
 * TCK run rate for a single day — THE team run rate from
 * services/team-run-rate.ts (the same number the building station, Analytics
 * and the day chart show; live while today's building is on).
 */
export async function computeBuilderBatchesPerHourForDay(dateIso: string): Promise<BuilderDayRate> {
  const byDay = await computeBuilderBatchesPerHourForDays([dateIso]);
  return byDay.get(dateIso) ?? EMPTY_BUILDER_RATE;
}

export interface BuilderDayRate {
  totalBatches: number;
  activeMinutes: number;
  batchesPerHour: number | null;
  /** Improvement time taken off production time (lib/improvement-kpi-credit.ts). */
  improvementMinutesCredited: number;
  /** The run rate without the improvement credit. */
  batchesPerHourBeforeCredit: number | null;
}
const EMPTY_BUILDER_RATE: BuilderDayRate = { totalBatches: 0, activeMinutes: 0, batchesPerHour: null, improvementMinutesCredited: 0, batchesPerHourBeforeCredit: null };

/**
 * The same run rate for several London days in ONE read (the morning
 * meeting's 7-production-day trend, 2026-10-22). Which batches count, the
 * finish press, live-or-finished and the improvement credit are all decided
 * in services/team-run-rate.ts — this only reshapes its result — so the
 * meetings can never disagree with the station or Analytics (28 Nov 2026).
 */
export async function computeBuilderBatchesPerHourForDays(datesIso: readonly string[]): Promise<Map<string, BuilderDayRate>> {
  const out = new Map<string, BuilderDayRate>();
  if (datesIso.length === 0) return out;
  const days = await teamRunRateForDates(datesIso);
  for (const date of datesIso) {
    const result = days.get(date)?.result;
    out.set(date, result ? {
      totalBatches: result.batches,
      activeMinutes: result.activeMinutes,
      batchesPerHour: result.batchesPerHour,
      improvementMinutesCredited: result.improvementMinutesCredited,
      batchesPerHourBeforeCredit: result.batchesPerHourBeforeCredit,
    } : EMPTY_BUILDER_RATE);
  }
  return out;
}

/**
 * Packing orders/hour for a single dispatch day, matching the
 * calculation on /api/reports/packing-speed.
 *
 * Reads Shopify fulfillment timestamps (not local batch_completions
 * — the kitchen doesn't log packing completions locally, they're
 * captured by Shopify when the order is marked fulfilled). The
 * active window is wallclock minus any idle gaps over 10 minutes.
 *
 * dispatchDateIso is the day the order shipped FROM the kitchen.
 * Orders ship on day N for delivery on N+1, so we look up the tag
 * for the delivery day.
 */
const IDLE_THRESHOLD_MS = 10 * 60 * 1000;

export async function computePackingOrdersPerHourForDay(dispatchDateIso: string): Promise<{
  totalOrders: number;
  activeMinutes: number;
  ordersPerHour: number | null;
}> {
  const dispatchDay = new Date(`${dispatchDateIso}T00:00:00`);
  const deliveryDay = new Date(dispatchDay);
  deliveryDay.setDate(dispatchDay.getDate() + 1);
  const yyyy = deliveryDay.getUTCFullYear();
  const mm = String(deliveryDay.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(deliveryDay.getUTCDate()).padStart(2, "0");
  const tag = `${yyyy}-${mm}-${dd}`;

  const orders = await getOrdersByTag(tag);
  const fulfilled = orders.filter(o => o.fulfillment_status === "fulfilled");
  if (fulfilled.length === 0) {
    return { totalOrders: 0, activeMinutes: 0, ordersPerHour: null };
  }

  const timestamps: number[] = [];
  for (const order of fulfilled) {
    const fuls = order.fulfillments ?? [];
    const successFuls = fuls.filter(f => f.status === "success" || f.status === "fulfilled");
    if (successFuls.length > 0) {
      for (const f of successFuls) timestamps.push(new Date(f.created_at).getTime());
    } else {
      timestamps.push(new Date(order.created_at).getTime());
    }
  }

  const sorted = [...timestamps].sort((a, b) => a - b);
  const firstTs = sorted[0];
  const lastTs = sorted[sorted.length - 1];
  const windowMs = lastTs - firstTs;

  let idleMs = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > IDLE_THRESHOLD_MS) idleMs += gap;
  }

  const activeMs = Math.max(0, windowMs - idleMs);
  if (activeMs <= 60_000) {
    return { totalOrders: fulfilled.length, activeMinutes: 0, ordersPerHour: null };
  }
  const activeMinutes = Math.round(activeMs / 60_000);
  const ordersPerHour = Math.round((fulfilled.length / (activeMs / 3_600_000)) * 10) / 10;
  return { totalOrders: fulfilled.length, activeMinutes, ordersPerHour };
}

/**
 * Packing orders/hour for several PAST dispatch days (the meeting's trend).
 * Each day is one Shopify tag read through the very same function as the
 * headline — no second formula. A finished day's fulfilments don't change,
 * so results are kept in memory for a few hours: the slide reloads every
 * morning without re-reading six days from Shopify each time.
 */
const PACKING_MEMO_MS = 6 * 60 * 60 * 1000;
const packingMemo = new Map<string, { at: number; value: PackingDayRate }>();
type PackingDayRate = Awaited<ReturnType<typeof computePackingOrdersPerHourForDay>>;

export async function computePackingOrdersPerHourForPastDays(
  dispatchDatesIso: readonly string[],
  todayIso: string,
): Promise<Map<string, PackingDayRate | null>> {
  const now = Date.now();
  const entries = await Promise.all(dispatchDatesIso.map(async (date): Promise<[string, PackingDayRate | null]> => {
    const cached = packingMemo.get(date);
    if (date < todayIso && cached && now - cached.at < PACKING_MEMO_MS) return [date, cached.value];
    try {
      const value = await computePackingOrdersPerHourForDay(date);
      if (date < todayIso) packingMemo.set(date, { at: now, value });
      return [date, value];
    } catch (err) {
      console.warn(`[yesterday-kpis] packing orders/hr for ${date} failed:`, err);
      return [date, null];
    }
  }));
  return new Map(entries);
}

/**
 * Improvements COMPLETED on a single London day — the fourth meeting KPI
 * (Graeme, 2026-09-18: completed improvements, never ideas). The definition
 * lives in lib/improvements-completed.ts: status awaiting_approval or
 * complete, bucketed by done_at (the doing), never approved_at (the later
 * sign-off). Both the morning meeting (yesterday) and the end-of-day page
 * (today) call this, so the two meetings can never disagree on the number.
 */
export async function countImprovementsCompletedForDay(dateIso: string): Promise<number> {
  const byDay = await countImprovementsCompletedForDays([dateIso]);
  return byDay.get(dateIso) ?? 0;
}

/** The same count for several London days from ONE read of the done rows. */
export async function countImprovementsCompletedForDays(datesIso: readonly string[]): Promise<Map<string, number>> {
  // The window filter lives in the pure, tested function; SQL just narrows
  // to rows that could possibly count (done statuses with a done_at stamp).
  const rows = await db
    .select({
      progressStatus: improvementSubmissionsTable.progressStatus,
      doneAt: improvementSubmissionsTable.doneAt,
    })
    .from(improvementSubmissionsTable)
    .where(and(
      inArray(improvementSubmissionsTable.progressStatus, [...IMPROVEMENT_DONE_STATUSES]),
      isNotNull(improvementSubmissionsTable.doneAt),
    ));

  const out = new Map<string, number>();
  for (const date of datesIso) {
    // Noon UTC is unambiguously the right London date in both GMT and BST.
    const anchor = new Date(`${date}T12:00:00Z`);
    out.set(date, countImprovementsCompletedInWindow(rows, londonStartOfDay(anchor), londonEndOfDay(anchor)));
  }
  return out;
}
