/**
 * How far through one delivery date's courier wave the packing bench is —
 * the packing station's progress readout and the fulfilment header's count
 * (GET /fulfilment/dispatch-progress), and the "everything packed" check
 * before the packing and wrapping shift can be closed down
 * (services/shift-close-down.ts). One copy, so they can never disagree.
 *
 * Collections are excluded from every number here: it measures ONE thing,
 * the courier wave for this delivery date, packed the day before. A
 * collection carrying the same date tag is handed over on the date itself,
 * so counting it put orders nobody was packing today into today's totals
 * (Graeme, 2026-09-03). An unfulfilled order held for an open chargeback
 * isn't work for the bench, so it isn't counted as still to pack (Graeme,
 * 19 Oct 2026).
 */
import { getOrdersByTag } from "./shopify";
import { settlingOrders } from "../lib/order-age";
import { isPartOfDespatchWave } from "../lib/dispatch-tag";
import { DISPUTE_ON_DEMAND_MIN_AGE_MS, isHeldForChargeback } from "../lib/order-disputes";
import { ensureFreshDisputes, loadOpenDisputes } from "../lib/order-disputes-store";

type Count = { total: number; fulfilled: number };

export interface DispatchProgress {
  tag: string;
  totalOrders: number;
  totalFulfilled: number;
  categories: { smallBox: Count; largeBox: Count; wholesale: Count; other: Count };
  settling: ReturnType<typeof settlingOrders>;
}

export async function dispatchProgressForTag(tag: string): Promise<DispatchProgress> {
  await ensureFreshDisputes(DISPUTE_ON_DEMAND_MIN_AGE_MS);
  const held = new Set((await loadOpenDisputes()).keys());
  const allOrders = (await getOrdersByTag(tag))
    .filter(o => isPartOfDespatchWave(o.tags))
    .filter(o => o.fulfillment_status === "fulfilled" || !isHeldForChargeback(o, held));

  const categories = {
    smallBox: { total: 0, fulfilled: 0 },
    largeBox: { total: 0, fulfilled: 0 },
    wholesale: { total: 0, fulfilled: 0 },
    other: { total: 0, fulfilled: 0 },
  };

  for (const order of allOrders) {
    const tags = order.tags.split(",").map(t => t.trim().toLowerCase());
    const isFulfilled = order.fulfillment_status === "fulfilled";
    const cat = tags.includes("wholesale") ? categories.wholesale
      : tags.includes("large box") ? categories.largeBox
      : tags.includes("small box") ? categories.smallBox
      : categories.other;
    cat.total += 1;
    if (isFulfilled) cat.fulfilled += 1;
  }

  const totalOrders = allOrders.length;
  const totalFulfilled = allOrders.filter(o => o.fulfillment_status === "fulfilled").length;
  // Counted above but not yet on the pack list (under 15 minutes old —
  // lib/order-age.ts): the screen says so, with when each comes on.
  const settling = settlingOrders(allOrders);
  return { tag, totalOrders, totalFulfilled, categories, settling };
}
