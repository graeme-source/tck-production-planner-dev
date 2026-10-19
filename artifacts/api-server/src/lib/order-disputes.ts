/**
 * Chargeback holds on despatch — the pure half (Graeme, 19 Oct 2026).
 * Objective D.
 *
 * "An order was sent for despatch despite a chargeback being open for it.
 * Make sure we never send an order that's got an active or open chargeback."
 *
 * Where the signal comes from: Shopify's Order.disputes (OrderDisputeSummary
 * — status + initiatedAs CHARGEBACK/INQUIRY), readable with the read_orders
 * scope the app already has. The open list is found with the order search
 * filter `chargeback_status:needs_response OR chargeback_status:under_review`.
 * (The Shopify Payments disputes endpoints need read_shopify_payments_disputes,
 * which the app does not hold — and do not need.)
 *
 * Backup signal: a person can hold any order by hand by tagging it
 * "chargeback" (or "chargeback-hold" / "dispute") in Shopify — for a dispute
 * raised outside Shopify Payments (PayPal, Klarna…) that Shopify can't see.
 *
 * Everything here is pure; the DB + Shopify half is order-disputes-store.ts.
 */

/** Dispute statuses that mean the bank still has the money in question —
 *  the order must not ship. Shopify DisputeStatus enum, lower-cased. */
const OPEN_STATUSES = new Set(["needs_response", "under_review"]);
/** Statuses that are finished — won, lost, accepted, refunded. */
const CLOSED_STATUSES = new Set(["won", "lost", "accepted", "charge_refunded", "prevented"]);

/**
 * Is a dispute with this status still open?
 * An UNKNOWN status counts as open: a new status Shopify adds tomorrow must
 * hold the order (a person can release it) rather than wave it through.
 */
export function isDisputeStatusOpen(status: string | null | undefined): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  if (!s) return false;
  if (OPEN_STATUSES.has(s)) return true;
  if (CLOSED_STATUSES.has(s)) return false;
  return true;
}

export type DisputeSummary = { status: string | null | undefined; initiatedAs?: string | null };

/** "chargeback:under_review" for every OPEN dispute on an order. */
export function openDisputeLabels(disputes: DisputeSummary[] | null | undefined): string[] {
  return (disputes ?? [])
    .filter(d => isDisputeStatusOpen(d.status))
    .map(d => `${String(d.initiatedAs ?? "dispute").toLowerCase()}:${String(d.status).toLowerCase()}`);
}

/** Tags a person can put on an order in Shopify to hold it by hand. */
export const MANUAL_HOLD_TAGS = ["chargeback", "chargeback-hold", "dispute"] as const;

export function hasManualChargebackTag(tags: string | string[] | null | undefined): boolean {
  const list = Array.isArray(tags) ? tags : String(tags ?? "").split(",");
  const wanted = new Set<string>(MANUAL_HOLD_TAGS);
  return list.some(t => wanted.has(t.trim().toLowerCase()));
}

/** Plain-English description of the dispute labels, for messages. */
export function describeDisputes(labels: string[]): string {
  if (labels.length === 0) return "an open chargeback";
  return labels
    .map(l => {
      const [kind, status] = l.split(":");
      return `${kind === "inquiry" ? "an inquiry" : "a chargeback"} (${(status ?? "").replace(/_/g, " ")})`;
    })
    .join(" and ");
}

/** The message every refusal carries — shown on the bench as-is. */
export function chargebackHoldMessage(orderLabel: string, labels: string[], manualTag: boolean): string {
  const why = manualTag && labels.length === 0
    ? `it is tagged "chargeback" in Shopify`
    : `Shopify shows ${describeDisputes(labels)}`;
  return `Chargeback open on ${orderLabel} — do not send. ${why}. Put the order aside and tell Graeme; it can only go out once the dispute is closed.`;
}

/** How old the stored list may be before despatch stops trusting it alone. */
export const DISPUTE_LIST_STALE_AFTER_MS = 20 * 60_000;
/** Background refresh cadence. */
export const DISPUTE_REFRESH_EVERY_MS = 10 * 60_000;
/** On-demand refresh (packing screen load) skips if the list is younger. */
export const DISPUTE_ON_DEMAND_MIN_AGE_MS = 2 * 60_000;

export function isDisputeListStale(fetchedAt: Date | null, now: Date, staleAfterMs = DISPUTE_LIST_STALE_AFTER_MS): boolean {
  if (!fetchedAt) return true;
  return now.getTime() - fetchedAt.getTime() > staleAfterMs;
}

/** Result of asking Shopify directly about ONE order. */
export type DirectDisputeCheck =
  | { ok: true; openLabels: string[]; tags: string[] }
  | { ok: false; error: string };

export type DispatchGateInput = {
  orderLabel: string;
  /** Open-dispute labels from the stored list, or null when the order isn't in it. */
  listed: string[] | null;
  /** Order tags, when the caller has them. */
  tags?: string | string[] | null;
  /** Last SUCCESSFUL refresh of the stored list. */
  listFetchedAt: Date | null;
  now: Date;
  /** Present when a direct per-order check was made (because the list was
   *  stale, or the caller asked for a live check at the moment of despatch). */
  direct?: DirectDisputeCheck;
  staleAfterMs?: number;
};

export type DispatchGateDecision =
  | { allowed: true; warning?: string }
  | { allowed: false; code: "OPEN_CHARGEBACK"; message: string; labels: string[] };

/**
 * May this order be despatched (labelled, booked, fulfilled, tracking pushed)?
 *
 * Rules:
 *  - A manual hold tag always refuses.
 *  - A successful direct check is the freshest truth: open → refuse,
 *    none open → allow (the dispute may have closed since the last refresh).
 *  - Otherwise the stored list: listed → refuse. This is also what happens
 *    when Shopify can't be reached — an order we KNOW is disputed stays held.
 *  - Not listed but the list is stale and no direct answer could be had:
 *    allow with a warning. Shopify being down must not stop all packing;
 *    only orders already known disputed are failed safe.
 */
export function decideDispatch(input: DispatchGateInput): DispatchGateDecision {
  const staleAfter = input.staleAfterMs ?? DISPUTE_LIST_STALE_AFTER_MS;
  const directTags = input.direct?.ok ? input.direct.tags : [];
  const manual = hasManualChargebackTag(input.tags) || hasManualChargebackTag(directTags);

  const refuse = (labels: string[]): DispatchGateDecision => ({
    allowed: false,
    code: "OPEN_CHARGEBACK",
    labels,
    message: chargebackHoldMessage(input.orderLabel, labels, manual),
  });

  if (input.direct?.ok) {
    if (input.direct.openLabels.length > 0 || manual) return refuse(input.direct.openLabels);
    return { allowed: true };
  }

  if (manual) return refuse(input.listed ?? []);
  if (input.listed) return refuse(input.listed);

  if (input.direct && !input.direct.ok) {
    return {
      allowed: true,
      warning: `Couldn't check Shopify for a chargeback on ${input.orderLabel} (${input.direct.error}); it isn't on the last known list, so it was allowed.`,
    };
  }
  if (isDisputeListStale(input.listFetchedAt, input.now, staleAfter)) {
    return {
      allowed: true,
      warning: `The chargeback list is out of date (last refreshed ${input.listFetchedAt ? input.listFetchedAt.toISOString() : "never"}); ${input.orderLabel} isn't on it, so it was allowed.`,
    };
  }
  return { allowed: true };
}

/** Is this order held for despatch, judged from the stored list + its tags?
 *  Used to filter pack queues (no per-order Shopify call). */
export function isHeldForChargeback(
  order: { id: number; tags?: string | null },
  openOrderIds: ReadonlySet<number>,
): boolean {
  return openOrderIds.has(order.id) || hasManualChargebackTag(order.tags);
}

/**
 * EVERY path that can send an order on its way, and how hard each one checks.
 * A route guards itself by passing its own key here — and
 * order-disputes.test.ts fails if a listed route stops doing so.
 *
 *   live     — ask Shopify about this order every time (the moment of
 *              despatch: Shopify fulfilment + tracking push).
 *   list     — the stored list, with a direct check when it's stale.
 *   listOnly — the stored list (batch loops; the list is refreshed once
 *              at the start of the request).
 */
export const DISPATCH_PATHS = {
  // Packing bench — fulfil in Shopify + push APC tracking to the customer.
  "POST /orders/:id/complete": "live",
  "POST /orders/:id/scan-complete": "live",
  // Last line of defence inside the Shopify fulfilment call itself.
  "shopify.fulfillOrder": "list",
  // Full mode — book (or fetch the existing) APC label when an order is opened.
  "POST /shipments": "list",
  "POST /shipments/:waybill/add-parcel": "list",
  "POST /shipments/:waybill/reprint-label": "list",
  "GET /shipments/:waybill/label.pdf": "list",
  // Batch APC booking (first run + retries) and its preview.
  "POST /batch-book": "listOnly",
  "GET /batch-preflight": "listOnly",
  // Reconcile mode — hand-raised consignment lookup, label print, label scan.
  "GET /consignment-for-order": "list",
  "GET /reconcile-label": "list",
  "POST /verify-label-scan": "list",
  // Approving an order for despatch (step one of the wave).
  "POST /tag-dispatch": "list",
  "POST /tag-dispatch-bulk": "listOnly",
} as const satisfies Record<string, "live" | "list" | "listOnly">;

export type DispatchPath = keyof typeof DISPATCH_PATHS;

/** Shopify order search for every order with an open dispute. */
export const OPEN_DISPUTE_ORDER_QUERY = "chargeback_status:needs_response OR chargeback_status:under_review";

/** Numeric id from "gid://shopify/Order/123". */
export function orderIdFromGid(gid: string): number | null {
  const m = /\/Order\/(\d+)$/.exec(gid);
  return m ? Number(m[1]) : null;
}
