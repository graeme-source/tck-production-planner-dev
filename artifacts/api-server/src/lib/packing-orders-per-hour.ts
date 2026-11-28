/**
 * Packing boxes (orders) per hour for one dispatch day — ONE definition,
 * shared by Analytics → Packing speed (GET /api/reports/packing-speed), the
 * morning and end-of-day meetings and the room tiles
 * (lib/yesterday-kpis.ts computePackingOrdersPerHourForDay). Until 28 Nov
 * 2026 the two kept their own copies of this maths. Objective G.
 *
 * The method:
 *   - The day's orders are the ones tagged with the DELIVERY day (dispatch
 *     day + 1), fulfilled in Shopify.
 *   - Each successful fulfilment's time is a packing moment (an order with
 *     none uses its created time).
 *   - Window = first → last moment, minus every gap over 10 minutes.
 *   - Orders ÷ active hours, one decimal; no rate under a minute of work.
 *
 * Pure. Server-timezone proof: dates are YYYY-MM-DD strings throughout.
 */
import { addDaysToDateString } from "./london-time";

export const PACKING_IDLE_THRESHOLD_MS = 10 * 60 * 1000;

/** The Shopify delivery-day tag holding a dispatch day's orders. */
export function packingDeliveryTag(dispatchDateIso: string): string {
  return addDaysToDateString(dispatchDateIso, 1);
}

export interface PackingOrderLike {
  fulfillment_status?: string | null;
  created_at: string;
  fulfillments?: ReadonlyArray<{ status?: string | null; created_at: string }> | null;
}

export interface PackingPace {
  totalOrders: number;
  firstAt: number | null;
  lastAt: number | null;
  windowMs: number;
  idleMs: number;
  idleBreaks: number;
  activeMs: number;
  /** Whole minutes of packing; 0 when there's under a minute. */
  activeMinutes: number;
  ordersPerHour: number | null;
}

/** The fulfilled orders of a tag (the ones that count). */
export function fulfilledOrders<T extends PackingOrderLike>(orders: readonly T[]): T[] {
  return orders.filter(o => o.fulfillment_status === "fulfilled");
}

/** The packing moments of fulfilled orders. */
export function packingTimestamps(fulfilled: readonly PackingOrderLike[]): number[] {
  const out: number[] = [];
  for (const order of fulfilled) {
    const ok = (order.fulfillments ?? []).filter(f => f.status === "success" || f.status === "fulfilled");
    if (ok.length > 0) for (const f of ok) out.push(new Date(f.created_at).getTime());
    else out.push(new Date(order.created_at).getTime());
  }
  return out;
}

/** Orders per hour from the count and the packing moments. */
export function packingPace(totalOrders: number, timestamps: readonly number[]): PackingPace {
  const sorted = [...timestamps].sort((a, b) => a - b);
  if (totalOrders === 0 || sorted.length === 0) {
    return { totalOrders, firstAt: null, lastAt: null, windowMs: 0, idleMs: 0, idleBreaks: 0, activeMs: 0, activeMinutes: 0, ordersPerHour: null };
  }
  const firstAt = sorted[0]!;
  const lastAt = sorted[sorted.length - 1]!;
  const windowMs = lastAt - firstAt;
  let idleMs = 0;
  let idleBreaks = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]! - sorted[i - 1]!;
    if (gap > PACKING_IDLE_THRESHOLD_MS) { idleMs += gap; idleBreaks++; }
  }
  const activeMs = Math.max(0, windowMs - idleMs);
  const measurable = activeMs > 60_000;
  return {
    totalOrders,
    firstAt,
    lastAt,
    windowMs,
    idleMs,
    idleBreaks,
    activeMs,
    activeMinutes: measurable ? Math.round(activeMs / 60_000) : 0,
    ordersPerHour: measurable ? Math.round((totalOrders / (activeMs / 3_600_000)) * 10) / 10 : null,
  };
}

/** One dispatch day's pace straight from its tag's orders. */
export function packingPaceFromOrders(orders: readonly PackingOrderLike[]): PackingPace {
  const fulfilled = fulfilledOrders(orders);
  return packingPace(fulfilled.length, packingTimestamps(fulfilled));
}
