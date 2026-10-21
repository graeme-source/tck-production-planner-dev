// ── Regression: 21 Oct 2026 — a CANCELLED order was despatched ──────────
// Shopify #137271 was cancelled and refunded on 16 Oct but still carried its
// delivery-date tag 2026-10-22. The morning's "tag for dispatch" stamped it
// and an APC label was booked for it at 08:03; a packer noticed and cancelled
// the label by hand. "If an order is cancelled, we don't despatch it."
//
// And the clarification (Graeme, 21 Oct): ONLY cancelled_at decides. A
// refunded or partially refunded order that is not cancelled still goes out.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isCancelledOrder,
  withoutCancelledOrders,
  bulkTagCandidates,
  packQueueOrders,
  cancelledOrderMessage,
  cancelledOrderLabels,
} from "./dispatch-tag";
import { decideDispatch, DISPATCH_PATHS, DISPUTE_LIST_STALE_AFTER_MS, type DispatchGateInput } from "./order-disputes";

const NOW = new Date("2026-10-21T08:00:00+01:00");
const FRESH = new Date(NOW.getTime() - 5 * 60_000);
const STALE = new Date(NOW.getTime() - DISPUTE_LIST_STALE_AFTER_MS - 60_000);

type TestOrder = {
  id: number;
  name: string;
  tags: string;
  cancelled_at: string | null;
  financial_status: string;
  fulfillment_status: string | null;
};

/** #137271 as Shopify had it on the morning of 21 Oct, before tagging. */
const order137271: TestOrder = {
  id: 13616314646902,
  name: "#137271",
  tags: "2026-10-22, new-customer, Small Box, Thursday",
  cancelled_at: "2026-10-16T06:43:00+01:00",
  financial_status: "refunded",
  fulfillment_status: null,
};
/** ...and after the dispatch tag was (wrongly) added. */
const order137271Tagged: TestOrder = { ...order137271, tags: "2026-10-22, dispatch, new-customer, Small Box, Thursday" };

const refundedNotCancelled: TestOrder = {
  id: 1001, name: "#137300", tags: "2026-10-22, Small Box, Thursday",
  cancelled_at: null, financial_status: "refunded", fulfillment_status: null,
};
const partRefunded: TestOrder = {
  id: 1002, name: "#137301", tags: "2026-10-22, Large Box, Thursday",
  cancelled_at: null, financial_status: "partially_refunded", fulfillment_status: null,
};
const paid: TestOrder = {
  id: 1003, name: "#137302", tags: "2026-10-22, Small Box, Thursday",
  cancelled_at: null, financial_status: "paid", fulfillment_status: null,
};

describe("the cancelled-order rule", () => {
  it("#137271 (cancelled_at set, refunded, unfulfilled) is cancelled", () => {
    expect(isCancelledOrder(order137271)).toBe(true);
    expect(isCancelledOrder(order137271Tagged)).toBe(true);
  });
  it("refunded and partially refunded orders that are NOT cancelled are not cancelled", () => {
    expect(isCancelledOrder(refundedNotCancelled)).toBe(false);
    expect(isCancelledOrder(partRefunded)).toBe(false);
    expect(isCancelledOrder({ cancelled_at: null })).toBe(false);
    expect(isCancelledOrder({})).toBe(false);
    expect(isCancelledOrder(null)).toBe(false);
  });
  it("the tag fetch leaves cancelled orders out and keeps refunded ones", () => {
    const kept = withoutCancelledOrders([order137271Tagged, refundedNotCancelled, partRefunded, paid]);
    expect(kept.map(o => o.name)).toEqual(["#137300", "#137301", "#137302"]);
  });
  it("says when it was cancelled, in plain English", () => {
    expect(cancelledOrderMessage("#137271", order137271.cancelled_at)).toBe("#137271 was cancelled on 16 Oct — not despatched.");
    expect(cancelledOrderMessage("#137271", "not a date")).toBe("#137271 was cancelled — not despatched.");
  });
});

describe("bulk tag-for-dispatch", () => {
  it("skips #137271 but tags refunded and partially refunded orders", () => {
    const picked = bulkTagCandidates([order137271, refundedNotCancelled, partRefunded, paid]);
    expect(picked.map(o => o.name)).toEqual(["#137300", "#137301", "#137302"]);
  });
});

describe("the pick list / scan queue", () => {
  it("drops #137271 after it was cancelled, even though it carries the dispatch tag", () => {
    const tagged = [order137271Tagged, { ...refundedNotCancelled, tags: refundedNotCancelled.tags + ", dispatch" }, { ...partRefunded, tags: partRefunded.tags + ", dispatch" }];
    expect(packQueueOrders(tagged).map(o => o.name)).toEqual(["#137300", "#137301"]);
  });
});

describe("the despatch gate (tagging, booking, labels, completion)", () => {
  const base: DispatchGateInput = { orderLabel: "#137271", listed: null, listFetchedAt: FRESH, now: NOW };

  it("single tagging refuses #137271 with a clear message", () => {
    const d = decideDispatch({ ...base, cancelledAt: order137271.cancelled_at });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe("ORDER_CANCELLED");
      expect(d.message).toBe("#137271 was cancelled on 16 Oct — not despatched.");
    }
  });

  it("refuses when only Shopify's direct answer knows it's cancelled", () => {
    const d = decideDispatch({ ...base, direct: { ok: true, openLabels: [], tags: [], cancelledAt: order137271.cancelled_at } });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe("ORDER_CANCELLED");
  });

  it("a refunded or partially refunded order that isn't cancelled is still bookable", () => {
    expect(decideDispatch({ ...base, orderLabel: "#137300", cancelledAt: null }).allowed).toBe(true);
    expect(decideDispatch({ ...base, orderLabel: "#137301", cancelledAt: null, direct: { ok: true, openLabels: [], tags: [], cancelledAt: null } }).allowed).toBe(true);
  });

  // Every despatch path (tagging, APC booking + batch booking + preflight,
  // label reprint/print, scan-complete, complete, Shopify fulfilment) runs
  // through this gate — each must refuse a cancelled order however it checks.
  for (const [path, mode] of Object.entries(DISPATCH_PATHS)) {
    for (const listFresh of [true, false]) {
      it(`${path} (${mode}) refuses #137271 — list ${listFresh ? "fresh" : "stale"}`, () => {
        // listOnly paths pass the order's cancelled_at; live/list paths ask
        // Shopify when they don't have it (order-disputes-store checkDispatch).
        const input: DispatchGateInput = mode === "listOnly"
          ? { ...base, listFetchedAt: listFresh ? FRESH : STALE, cancelledAt: order137271.cancelled_at }
          : { ...base, listFetchedAt: listFresh ? FRESH : STALE, direct: { ok: true, openLabels: [], tags: [], cancelledAt: order137271.cancelled_at } };
        expect(decideDispatch(input).allowed).toBe(false);
      });
    }
  }
});

describe("a label booked before the order was cancelled", () => {
  it("is flagged 'Cancelled in Shopify — cancel this label'; live orders' labels are not", () => {
    const labels = cancelledOrderLabels(
      [
        { waybill: "2026102103036990020910", orderId: order137271.id, orderName: "#137271" },
        { waybill: "2026102103036990020911", orderId: refundedNotCancelled.id, orderName: "#137300" },
      ],
      [order137271Tagged, refundedNotCancelled],
    );
    expect(labels).toHaveLength(1);
    expect(labels[0].waybill).toBe("2026102103036990020910");
    expect(labels[0].message).toMatch(/^Cancelled in Shopify — cancel this label\./);
    expect(labels[0].message).toContain("cancelled on 16 Oct");
  });
});

// Structural half: the fetches ask Shopify for cancelled_at and the routes
// hand it to the gate — without it, nothing could see a cancellation.
describe("wiring", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const shopifySrc = readFileSync(`${here}../services/shopify.ts`, "utf8");
  const fulfilmentSrc = readFileSync(`${here}../routes/fulfilment.ts`, "utf8");
  const storeSrc = readFileSync(`${here}order-disputes-store.ts`, "utf8");

  function fnBody(src: string, signature: string): string {
    const start = src.indexOf(signature);
    expect(start, signature).toBeGreaterThanOrEqual(0);
    const next = src.indexOf("\nexport ", start + 1);
    return src.slice(start, next < 0 ? undefined : next);
  }

  it("the tag fetch requests cancelled_at and getOrdersByTag drops cancelled orders", () => {
    expect(fnBody(shopifySrc, "export async function getOrdersByTagIncludingCancelled(")).toMatch(/fields:[^;]*cancelled_at/);
    expect(fnBody(shopifySrc, "export async function getOrdersByTag(")).toContain("withoutCancelledOrders(");
  });
  for (const sig of ["export async function getRecentUnfulfilledOrders(", "export async function getOrderById(", "export async function findOrderByName("]) {
    it(`${sig.replace("export async function ", "").replace("(", "")} requests cancelled_at`, () => {
      expect(fnBody(shopifySrc, sig)).toContain("cancelled_at");
    });
  }
  it("the direct Shopify check asks for cancelledAt", () => {
    expect(storeSrc).toMatch(/query OrderDisputes\(\$id: ID!\)[^`]*cancelledAt/);
    expect(storeSrc).toMatch(/query OrderDisputesByName[^`]*cancelledAt/);
  });
  for (const path of ["POST /tag-dispatch", "POST /tag-dispatch-bulk", "POST /shipments", "POST /batch-book"]) {
    it(`${path} hands the order's cancelled_at to the gate`, () => {
      const [method, route] = path.split(" ");
      const start = fulfilmentSrc.indexOf(`router.${method.toLowerCase()}("${route}"`);
      expect(start).toBeGreaterThanOrEqual(0);
      const next = fulfilmentSrc.indexOf("\nrouter.", start + 1);
      expect(fulfilmentSrc.slice(start, next)).toMatch(/cancelledAt: \w+\.cancelled_at/);
    });
  }
});
