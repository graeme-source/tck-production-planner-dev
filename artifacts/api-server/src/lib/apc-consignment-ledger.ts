/**
 * The apc_consignments ledger — the database half of "may this order's
 * existing consignment be reused?" (incident #136845, 19 Oct 2026). The rules
 * themselves are pure, in apc-consignment-reuse.ts.
 *
 * Talks to APC only through fetchTrackingRaw — a read-only tracking GET with
 * a short timeout. Nothing here books, amends or cancels anything at APC.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { londonDateString } from "./london-time";
import { fetchTrackingRaw, isConfigured as isApcConfigured, APC_TRAINING_BASE } from "../services/apc";
import {
  decideAcrossRows, collectionDateOf, applyLiveStatus, liveStatusFromTracking, parseTrackingResponse,
  staleWaybillProblem, waybillSendDate, retireReasonFor,
  type LedgerConsignment, type LiveStatus, type ReuseContext, type ReuseDecision, type IsoDate,
} from "./apc-consignment-reuse";
import {
  cachedLiveStatus, needsTrackingRecheck, recordTrackingOutcome, isTrackingSlow, INITIAL_TRACKING_HEALTH,
  type CachedTrackingRow, type TrackingHealth,
} from "./apc-tracking-cache";

/** Packing-path timeout for the tracking check. */
export const LIVE_CHECK_TIMEOUT_MS = 3500;

type Row = {
  waybill: string;
  tracking_url: string | null;
  collection_date: string | null;
  created_at: Date | string | null;
  dispatch_tag: string | null;
  cancelled_at: Date | string | null;
  cancelled_reason: string | null;
  superseded_at: Date | string | null;
  superseded_reason: string | null;
};

function toLedger(r: Row): LedgerConsignment & { trackingUrl: string | null; cancelledReason: string | null; supersededReason: string | null } {
  return {
    waybill: String(r.waybill),
    collectionDate: r.collection_date ? String(r.collection_date).slice(0, 10) : null,
    createdAt: r.created_at,
    dispatchTag: r.dispatch_tag,
    cancelledAt: r.cancelled_at,
    supersededAt: r.superseded_at,
    trackingUrl: r.tracking_url ?? null,
    cancelledReason: r.cancelled_reason ?? null,
    supersededReason: r.superseded_reason ?? null,
  };
}

const ROW_COLUMNS = sql`waybill, tracking_url, collection_date::text AS collection_date, created_at, dispatch_tag,
  cancelled_at, cancelled_reason, superseded_at, superseded_reason`;

/** The collection date to store on a new row: APC's send date from the
 *  waybill (bookings always collect on the day they are made), else today. */
export function collectionDateForInsert(waybill: string): IsoDate {
  return waybillSendDate(waybill) ?? londonDateString();
}

/** Today's London date and the order's current delivery-date tag. */
export function reuseContext(orderDateTag: string | null | undefined): ReuseContext {
  return {
    today: londonDateString(),
    orderDateTag: orderDateTag && /^\d{4}-\d{2}-\d{2}$/.test(orderDateTag) ? orderDateTag : null,
  };
}

async function openRowsFor(orderId: number) {
  const rows = await db.execute<Row>(sql`
    SELECT ${ROW_COLUMNS} FROM apc_consignments
    WHERE shopify_order_id = ${orderId} AND cancelled_at IS NULL AND superseded_at IS NULL
    ORDER BY created_at DESC
  `);
  return rows.rows.map(toLedger);
}

// "Is APC tracking slow today?" — slow reads in a row, across packing and
// the background re-check (issue #339). In memory: one API process.
let trackingHealth: TrackingHealth = INITIAL_TRACKING_HEALTH;

/** True when several tracking reads in a row have failed recently — the
 *  pack list shows one banner instead of a warning per order. */
export function apcTrackingSlowNow(): boolean {
  return isTrackingSlow(trackingHealth, Date.now());
}

/** Read APC's tracking for one waybill. Never throws: an outage comes back as
 *  "unreachable" so the caller can fall back to the date rule. The result is
 *  cached on the row for the consignment check screen and the packing path. */
export async function liveStatusOf(waybill: string, apiBase?: string, timeoutMs = LIVE_CHECK_TIMEOUT_MS): Promise<LiveStatus> {
  if (!isApcConfigured()) return { kind: "unreachable", error: "APC credentials not configured" };
  let status: LiveStatus;
  try {
    const raw = await fetchTrackingRaw(waybill, { apiBase, timeoutMs });
    status = raw == null ? { kind: "not-found" } : liveStatusFromTracking(parseTrackingResponse(raw));
  } catch (err) {
    const msg = err instanceof Error ? (err.name === "TimeoutError" ? `no answer in ${Math.round(timeoutMs / 1000)}s` : err.message) : String(err);
    console.warn(`[apc-ledger] tracking check for ${waybill} failed — falling back to the date rule: ${msg}`);
    trackingHealth = recordTrackingOutcome(trackingHealth, "unreachable", Date.now());
    return { kind: "unreachable", error: msg };
  }
  trackingHealth = recordTrackingOutcome(trackingHealth, status.kind, Date.now());
  await cacheStatus(waybill, status);
  return status;
}

async function cacheStatus(waybill: string, status: LiveStatus): Promise<void> {
  if (status.kind === "not-found") {
    // No tracking yet (booked minutes ago) is an answer too: note WHEN we
    // asked so packing doesn't wait on APC to hear it again (#339). The
    // status columns are left as they were.
    try {
      await db.execute(sql`UPDATE apc_consignments SET apc_status_checked_at = NOW() WHERE waybill = ${waybill}`);
    } catch (err) {
      console.warn(`[apc-ledger] could not store APC check time for ${waybill}:`, err instanceof Error ? err.message : err);
    }
    return;
  }
  if (status.kind !== "ok") return;
  const latest = status.latest;
  const dead = status.deadEvent
    ? `${status.deadEvent.description ?? `status ${status.deadEvent.code}`}${status.deadEvent.dateTime ? ` (${status.deadEvent.dateTime})` : ""}`
    : null;
  try {
    await db.execute(sql`
      UPDATE apc_consignments SET
        apc_status = ${latest?.description ?? null},
        apc_status_code = ${latest?.code ?? null},
        apc_dead_status = ${dead},
        apc_status_checked_at = NOW()
      WHERE waybill = ${waybill}
    `);
  } catch (err) {
    console.warn(`[apc-ledger] could not store APC status for ${waybill}:`, err instanceof Error ? err.message : err);
  }
}

/** Stop a row ever being reused. It may still be live at APC — the
 *  consignment check screen asks a manager whether to cancel it there. */
export async function supersedeConsignment(waybill: string, reason: string): Promise<boolean> {
  const r = await db.execute(sql`
    UPDATE apc_consignments SET superseded_at = NOW(), superseded_reason = ${reason.slice(0, 500)}
    WHERE waybill = ${waybill} AND superseded_at IS NULL AND cancelled_at IS NULL
    RETURNING waybill
  `);
  if (r.rows.length) console.log(`[apc-ledger] ${waybill} superseded: ${reason}`);
  return r.rows.length > 0;
}

/** APC itself says the consignment is dead — record that on our row. */
export async function markCancelledInApc(waybill: string, reason = "cancelled in APC"): Promise<void> {
  await db.execute(sql`
    UPDATE apc_consignments
    SET cancelled_at = COALESCE(cancelled_at, NOW()), cancelled_reason = COALESCE(cancelled_reason, ${reason})
    WHERE waybill = ${waybill}
  `);
  console.log(`[apc-ledger] ${waybill} marked cancelled: ${reason}`);
}

async function retire(waybill: string, how: "supersede" | "cancel", message: string): Promise<void> {
  try {
    if (how === "cancel") await markCancelledInApc(waybill);
    else await supersedeConsignment(waybill, message);
  } catch (err) {
    // The decision already ignores this row for this call; a failed write
    // only means the next call decides again.
    console.error(`[apc-ledger] could not retire ${waybill}:`, err instanceof Error ? err.message : err);
  }
}

export interface ReuseOutcome {
  decision: ReuseDecision;
  /** Tracking URL stored on the reused row. */
  trackingUrl: string | null;
}

/**
 * THE reuse check for every booking path (packing open, batch booking). Reads
 * the order's not-yet-retired rows, applies the date rule, retires anything
 * stale, and — for a same-day candidate, when checkApc — asks APC's tracking
 * whether it has been cancelled. APC unreachable → date rule only, logged.
 */
export async function reusableConsignmentFor(
  orderId: number,
  ctx: ReuseContext,
  opts: { apiBase?: string; checkApc: boolean },
): Promise<ReuseOutcome> {
  const rows = await openRowsFor(orderId);
  const { decision: first, retire: stale } = decideAcrossRows(rows, ctx);
  for (const s of stale) await retire(s.waybill, s.how, s.message);

  let decision = first;
  if (decision.action === "reuse" && opts.checkApc) {
    // A recent background answer is used as-is — opening an order never
    // waits on APC when we already know (issue #339).
    const status = cachedLiveStatus(await cachedTrackingOf(decision.waybill), Date.now())
      ?? await liveStatusOf(decision.waybill, opts.apiBase);
    decision = applyLiveStatus(decision, status, ctx);
    if (decision.action === "reuse" && decision.notice) console.warn(`[apc-ledger] order ${orderId}: ${decision.notice}`);
    if (decision.action === "book-new" && decision.waybill && decision.retire) {
      await retire(decision.waybill, decision.retire, retireReasonFor(decision, ctx));
    }
  }
  if (decision.action === "book-new" && decision.waybill) {
    console.log(`[apc-ledger] order ${orderId}: not reusing ${decision.waybill} — ${decision.reason}`);
  }
  const reused = decision.action === "reuse" ? rows.find(r => r.waybill === decision.waybill) : undefined;
  return { decision, trackingUrl: reused?.trackingUrl ?? null };
}

async function cachedTrackingOf(waybill: string): Promise<CachedTrackingRow | null> {
  try {
    const r = await db.execute<CachedTrackingRow>(sql`
      SELECT apc_status, apc_status_code, apc_dead_status, apc_status_checked_at
      FROM apc_consignments WHERE waybill = ${waybill} LIMIT 1
    `);
    return r.rows[0] ?? null;
  } catch {
    return null; // no cache → ask APC live, exactly as before
  }
}

// ── Background re-check of today's consignments (issue #339) ─────────────
// Runs after batch booking and while the pick list is open, so the answer
// is already cached when a packer opens an order. Nobody waits on it, so it
// can give APC longer than the packing path does. Read-only at APC.
const BACKGROUND_TIMEOUT_MS = 8000;
const BACKGROUND_CONCURRENCY = 3;
const BACKGROUND_MAX_READS = 250;
const BACKGROUND_MIN_GAP_MS = 2 * 60_000;
let backgroundRun: Promise<void> | null = null;
let backgroundLastStart = 0;

/** APC base URL for background reads: the training API when the app's
 *  apc_test_mode setting is on, else live (same rule as the packing routes). */
export async function apcBaseFromSettings(): Promise<string | undefined> {
  const r = await db.execute<{ value: string | null }>(sql`SELECT value FROM app_settings WHERE key = 'apc_test_mode'`);
  return r.rows[0]?.value === "true" ? APC_TRAINING_BASE : undefined;
}

/** Fire-and-forget: re-read today's open consignments whose cached answer
 *  is missing or getting old. Never throws; one run at a time; throttled. */
export function refreshTodaysTrackingInBackground(apiBase?: string): void {
  if (!isApcConfigured() || backgroundRun) return;
  if (Date.now() - backgroundLastStart < BACKGROUND_MIN_GAP_MS) return;
  backgroundLastStart = Date.now();
  backgroundRun = (async () => {
    const rows = await db.execute<CachedTrackingRow & { waybill: string }>(sql`
      SELECT waybill, apc_status, apc_status_code, apc_dead_status, apc_status_checked_at
      FROM apc_consignments
      WHERE collection_date = ${londonDateString()}::date
        AND cancelled_at IS NULL AND superseded_at IS NULL
      ORDER BY apc_status_checked_at ASC NULLS FIRST
    `);
    const now = Date.now();
    const queue = rows.rows
      .filter(r => needsTrackingRecheck(r, now))
      .map(r => String(r.waybill))
      .slice(0, BACKGROUND_MAX_READS);
    const worker = async () => {
      for (;;) {
        const w = queue.shift();
        if (!w) return;
        const s = await liveStatusOf(w, apiBase, BACKGROUND_TIMEOUT_MS);
        if (s.kind === "ok" && s.dead) {
          // Our ledger should say what APC says; packing re-decides on open.
          try { await markCancelledInApc(w); } catch (err) {
            console.warn(`[apc-ledger] could not mark ${w} cancelled:`, err instanceof Error ? err.message : err);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: BACKGROUND_CONCURRENCY }, worker));
  })()
    .catch(err => console.warn("[apc-ledger] background tracking re-check failed:", err instanceof Error ? err.message : err))
    .finally(() => { backgroundRun = null; });
}

/** Read-only version for previews (batch preflight, the picking screen's
 *  "will reuse" hint): the date rule only, no APC, no writes. */
export async function peekReusableConsignment(orderId: number, ctx: ReuseContext): Promise<ReuseDecision> {
  return decideAcrossRows(await openRowsFor(orderId), ctx).decision;
}

/** Bulk read-only version for the picking screen: order id → reusable row. */
export async function reusableConsignmentsFor(orderIds: number[], ctxFor: (orderId: number) => ReuseContext) {
  if (orderIds.length === 0) return new Map<number, { waybill: string; trackingUrl: string | null }>();
  const rows = await db.execute<Row & { shopify_order_id: string | number }>(sql`
    SELECT shopify_order_id, ${ROW_COLUMNS} FROM apc_consignments
    WHERE shopify_order_id IN (${sql.join(orderIds.map(id => sql`${id}`), sql`, `)})
      AND cancelled_at IS NULL AND superseded_at IS NULL
    ORDER BY created_at DESC
  `);
  const byOrder = new Map<number, ReturnType<typeof toLedger>[]>();
  for (const r of rows.rows) {
    const id = Number(r.shopify_order_id);
    const list = byOrder.get(id) ?? [];
    list.push(toLedger(r));
    byOrder.set(id, list);
  }
  const out = new Map<number, { waybill: string; trackingUrl: string | null }>();
  for (const [id, list] of byOrder) {
    const d = decideAcrossRows(list, ctxFor(id)).decision;
    if (d.action === "reuse") out.set(id, { waybill: d.waybill, trackingUrl: list.find(l => l.waybill === d.waybill)?.trackingUrl ?? null });
  }
  return out;
}

/** The print / push-to-Shopify guard: null when this waybill may go on a box
 *  or to the customer today, otherwise the message to show the packer. */
export async function staleProblemForWaybill(waybill: string): Promise<string | null> {
  const rows = await db.execute<Row>(sql`SELECT ${ROW_COLUMNS} FROM apc_consignments WHERE waybill = ${waybill} LIMIT 1`);
  const row = rows.rows[0] ? toLedger(rows.rows[0]) : null;
  return staleWaybillProblem(waybill, row, londonDateString());
}

/**
 * The order's delivery date changed through the app: every consignment it
 * still holds is retired so none can ever be reused. Returns them so the
 * caller can ask a manager about any that are still live at APC.
 */
export async function supersedeOrderConsignments(orderId: number, reason: string): Promise<Array<{ waybill: string; collectionDate: IsoDate | null }>> {
  const r = await db.execute<{ waybill: string; collection_date: string | null; created_at: Date | string | null }>(sql`
    UPDATE apc_consignments SET superseded_at = NOW(), superseded_reason = ${reason.slice(0, 500)}
    WHERE shopify_order_id = ${orderId} AND superseded_at IS NULL AND cancelled_at IS NULL
    RETURNING waybill, collection_date::text AS collection_date, created_at
  `);
  const out = r.rows.map(x => ({
    waybill: String(x.waybill),
    collectionDate: collectionDateOf({ waybill: String(x.waybill), collectionDate: x.collection_date, createdAt: x.created_at }),
  }));
  if (out.length) console.log(`[apc-ledger] order ${orderId}: superseded ${out.map(o => o.waybill).join(", ")} — ${reason}`);
  return out;
}
