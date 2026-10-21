/**
 * Chargeback holds on despatch — the DB + Shopify half (Graeme, 19 Oct 2026).
 * Objective D. Rules live in lib/order-disputes.ts (pure, tested).
 *
 * READ-ONLY towards Shopify: GraphQL queries only, never a mutation.
 *
 *   refreshOpenDisputes()     pull every order with an open dispute into
 *                             open_order_disputes (replaces the set).
 *   ensureFreshDisputes()     refresh when older than a given age; never throws.
 *   startDisputeRefreshJob()  every 10 minutes from boot.
 *   checkDispatch()           the gate every despatch path calls.
 *   assertDispatchAllowed()   same, throwing DispatchHeldError (→ 409).
 */
import { db, openOrderDisputesTable, orderDisputeRefreshTable, apcConsignmentsTable } from "@workspace/db";
import { eq, notInArray } from "drizzle-orm";
import { shopifyGraphQL } from "../services/shopify";
import {
  decideDispatch,
  isDisputeListStale,
  openDisputeLabels,
  orderIdFromGid,
  OPEN_DISPUTE_ORDER_QUERY,
  DISPUTE_REFRESH_EVERY_MS,
  type DirectDisputeCheck,
  type DispatchGateDecision,
  type DispatchRefusalCode,
} from "./order-disputes";

type DisputeNode = {
  id: string;
  name: string;
  tags: string[];
  disputes: Array<{ status: string; initiatedAs: string | null }>;
  /** Only on the per-order queries (the cancelled-order refusal). */
  cancelledAt?: string | null;
};

const LIST_QUERY = `
  query OpenDisputeOrders($q: String!, $after: String) {
    orders(first: 100, after: $after, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes { id name tags disputes { status initiatedAs } }
    }
  }
`;

let inflight: Promise<number> | null = null;

/** Replace the stored set with Shopify's current open disputes. Returns the
 *  number of orders held. Single-flight: concurrent callers share one run. */
export function refreshOpenDisputes(): Promise<number> {
  if (inflight) return inflight;
  inflight = (async () => {
    const attemptedAt = new Date();
    try {
      const rows: Array<{ shopifyOrderId: number; orderName: string; statuses: string[] }> = [];
      let after: string | null = null;
      for (let page = 0; page < 20; page++) {
        const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: DisputeNode[] } } =
          await shopifyGraphQL(LIST_QUERY, { q: OPEN_DISPUTE_ORDER_QUERY, after });
        for (const node of data.orders.nodes) {
          const id = orderIdFromGid(node.id);
          // The search filter finds candidates; the dispute statuses on the
          // order decide (the search index can lag a status change).
          const labels = openDisputeLabels(node.disputes);
          if (id != null && labels.length > 0) rows.push({ shopifyOrderId: id, orderName: node.name, statuses: labels });
        }
        if (!data.orders.pageInfo.hasNextPage) break;
        after = data.orders.pageInfo.endCursor;
      }

      await db.transaction(async tx => {
        const ids = rows.map(r => r.shopifyOrderId);
        if (ids.length === 0) {
          await tx.delete(openOrderDisputesTable);
        } else {
          await tx.delete(openOrderDisputesTable).where(notInArray(openOrderDisputesTable.shopifyOrderId, ids));
          for (const r of rows) {
            await tx.insert(openOrderDisputesTable)
              .values({ shopifyOrderId: r.shopifyOrderId, orderName: r.orderName, statuses: r.statuses })
              .onConflictDoUpdate({
                target: openOrderDisputesTable.shopifyOrderId,
                set: { orderName: r.orderName, statuses: r.statuses, updatedAt: new Date() },
              });
          }
        }
        await tx.insert(orderDisputeRefreshTable)
          .values({ id: 1, fetchedAt: attemptedAt, attemptedAt, lastError: null })
          .onConflictDoUpdate({ target: orderDisputeRefreshTable.id, set: { fetchedAt: attemptedAt, attemptedAt, lastError: null } });
      });
      return rows.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[order-disputes] refresh FAILED — despatch falls back to per-order checks:", msg);
      try {
        await db.insert(orderDisputeRefreshTable)
          .values({ id: 1, attemptedAt, lastError: msg.slice(0, 500) })
          .onConflictDoUpdate({ target: orderDisputeRefreshTable.id, set: { attemptedAt, lastError: msg.slice(0, 500) } });
      } catch (dbErr) {
        console.error("[order-disputes] could not record the refresh failure:", dbErr);
      }
      throw err;
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

export type DisputeListState = { fetchedAt: Date | null; attemptedAt: Date | null; lastError: string | null };

export async function disputeListState(): Promise<DisputeListState> {
  const [row] = await db.select().from(orderDisputeRefreshTable).where(eq(orderDisputeRefreshTable.id, 1));
  return { fetchedAt: row?.fetchedAt ?? null, attemptedAt: row?.attemptedAt ?? null, lastError: row?.lastError ?? null };
}

/** Refresh if the list is older than maxAgeMs. Never throws — the outcome
 *  is in the returned state (lastError / fetchedAt). */
export async function ensureFreshDisputes(maxAgeMs: number): Promise<DisputeListState> {
  const state = await disputeListState();
  if (!isDisputeListStale(state.fetchedAt, new Date(), maxAgeMs)) return state;
  try {
    await refreshOpenDisputes();
  } catch {
    // Logged and recorded inside refreshOpenDisputes.
  }
  return disputeListState();
}

/** Every stored open dispute, keyed by order id. */
export async function loadOpenDisputes(): Promise<Map<number, { orderName: string | null; statuses: string[] }>> {
  const rows = await db.select().from(openOrderDisputesTable);
  return new Map(rows.map(r => [Number(r.shopifyOrderId), { orderName: r.orderName, statuses: r.statuses }]));
}

let jobStarted = false;
/** Background refresh every 10 minutes (first run 20s after boot). */
export function startDisputeRefreshJob(): void {
  if (jobStarted) return;
  jobStarted = true;
  const run = () => void refreshOpenDisputes()
    .then(n => console.log(`[order-disputes] ${n} order(s) held for an open chargeback`))
    .catch(() => undefined);
  setTimeout(run, 20_000).unref();
  setInterval(run, DISPUTE_REFRESH_EVERY_MS).unref();
}

const ORDER_BY_ID_QUERY = `
  query OrderDisputes($id: ID!) { order(id: $id) { id name tags cancelledAt disputes { status initiatedAs } } }
`;
const ORDER_BY_NAME_QUERY = `
  query OrderDisputesByName($q: String!) { orders(first: 5, query: $q) { nodes { id name tags cancelledAt disputes { status initiatedAs } } } }
`;

function normaliseName(name: string): string {
  const t = name.trim();
  return t.startsWith("#") ? t : `#${t}`;
}

/** Ask Shopify about ONE order, and keep the stored list in step with the answer. */
async function directCheck(ref: { orderId?: number | null; orderName?: string | null }): Promise<DirectDisputeCheck & { orderId?: number; orderName?: string }> {
  try {
    let node: DisputeNode | null = null;
    if (ref.orderId) {
      const data = await shopifyGraphQL<{ order: DisputeNode | null }>(ORDER_BY_ID_QUERY, { id: `gid://shopify/Order/${ref.orderId}` });
      node = data.order;
    } else if (ref.orderName) {
      const name = normaliseName(ref.orderName);
      const data = await shopifyGraphQL<{ orders: { nodes: DisputeNode[] } }>(ORDER_BY_NAME_QUERY, { q: `name:${name}` });
      node = data.orders.nodes.find(n => n.name === name) ?? null;
    }
    if (!node) return { ok: true, openLabels: [], tags: [] };
    const labels = openDisputeLabels(node.disputes);
    const id = orderIdFromGid(node.id);
    if (id != null) {
      try {
        if (labels.length > 0) {
          await db.insert(openOrderDisputesTable)
            .values({ shopifyOrderId: id, orderName: node.name, statuses: labels })
            .onConflictDoUpdate({ target: openOrderDisputesTable.shopifyOrderId, set: { orderName: node.name, statuses: labels, updatedAt: new Date() } });
        } else {
          await db.delete(openOrderDisputesTable).where(eq(openOrderDisputesTable.shopifyOrderId, id));
        }
      } catch (dbErr) {
        console.warn("[order-disputes] could not update stored row after direct check:", dbErr instanceof Error ? dbErr.message : dbErr);
      }
    }
    return { ok: true, openLabels: labels, tags: node.tags ?? [], cancelledAt: node.cancelledAt ?? null, orderId: id ?? undefined, orderName: node.name };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type DispatchRef = {
  orderId?: number | null;
  orderName?: string | null;
  /** Order tags if the caller already has them (manual "chargeback" tag). */
  tags?: string | string[] | null;
  /**
   * "live"  — always ask Shopify about this order (the moment of despatch:
   *           fulfil / push tracking). Falls back to the stored list if
   *           Shopify can't be reached.
   * "list"  — the stored list; a direct check only when it is stale.
   * "listOnly" — the stored list, never a Shopify call (batch loops, after
   *           ensureFreshDisputes has already been tried once).
   */
  mode?: "live" | "list" | "listOnly";
  /**
   * Shopify's cancelled_at, when the caller fetched the order with it
   * (null = known not cancelled). Left undefined, a "list" check asks
   * Shopify about this one order so a cancellation is never missed
   * (21 Oct 2026); "listOnly" callers must pass it.
   */
  cancelledAt?: string | null;
};

/** The gate. Every despatch path calls this (or assertDispatchAllowed). */
export async function checkDispatch(ref: DispatchRef): Promise<DispatchGateDecision> {
  const mode = ref.mode ?? "list";
  let label = ref.orderName ? normaliseName(ref.orderName) : ref.orderId ? `order ${ref.orderId}` : "this order";

  let listed: string[] | null = null;
  let state: DisputeListState = { fetchedAt: null, attemptedAt: null, lastError: null };
  try {
    state = await disputeListState();
    const rows = ref.orderId
      ? await db.select().from(openOrderDisputesTable).where(eq(openOrderDisputesTable.shopifyOrderId, ref.orderId))
      : ref.orderName
        ? await db.select().from(openOrderDisputesTable).where(eq(openOrderDisputesTable.orderName, normaliseName(ref.orderName)))
        : [];
    if (rows[0]) {
      listed = rows[0].statuses;
      if (!ref.orderName && rows[0].orderName) label = rows[0].orderName;
    }
  } catch (err) {
    console.error("[order-disputes] stored list unreadable — asking Shopify directly:", err instanceof Error ? err.message : err);
  }

  const now = new Date();
  let direct: DirectDisputeCheck | undefined;
  // A cancellation has no stored list, so a "list" caller that doesn't know
  // the order's cancelled_at asks Shopify about this one order.
  const cancellationUnknown = ref.cancelledAt === undefined;
  const wantDirect = mode === "live" || (mode === "list" && (isDisputeListStale(state.fetchedAt, now) || cancellationUnknown));
  if (wantDirect && (ref.orderId || ref.orderName)) {
    const result = await directCheck(ref);
    if (!ref.orderName && result.ok && result.orderName) label = result.orderName;
    direct = result;
  }

  const decision = decideDispatch({ orderLabel: label, listed, tags: ref.tags, listFetchedAt: state.fetchedAt, now, direct, cancelledAt: ref.cancelledAt });
  if (decision.allowed && decision.warning) console.warn(`[order-disputes] ${decision.warning}`);
  if (!decision.allowed) console.warn(`[order-disputes] REFUSED despatch of ${label}: ${decision.code === "ORDER_CANCELLED" ? "order cancelled" : decision.labels.join(", ") || "manual tag"}`);
  return decision;
}

/** Thrown when an order must not be despatched. Routes turn it into a 409. */
export class DispatchHeldError extends Error {
  readonly status = 409;
  constructor(message: string, readonly labels: string[], readonly code: DispatchRefusalCode = "OPEN_CHARGEBACK") {
    super(message);
    this.name = "DispatchHeldError";
  }
}

export async function assertDispatchAllowed(ref: DispatchRef): Promise<void> {
  const d = await checkDispatch(ref);
  if (!d.allowed) throw new DispatchHeldError(d.message, d.labels, d.code);
}

/** The order a consignment belongs to, from our ledger (waybill routes). */
export async function orderIdForWaybill(waybill: string): Promise<{ orderId: number | null; orderName: string | null }> {
  const [row] = await db
    .select({ id: apcConsignmentsTable.shopifyOrderId, name: apcConsignmentsTable.shopifyOrderName })
    .from(apcConsignmentsTable)
    .where(eq(apcConsignmentsTable.waybill, waybill));
  return { orderId: row?.id != null ? Number(row.id) : null, orderName: row?.name ?? null };
}
