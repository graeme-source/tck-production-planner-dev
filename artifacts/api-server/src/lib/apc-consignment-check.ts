/**
 * Daily APC consignment check (incident #136845, Graeme 19 Oct 2026).
 *
 * Lists every order that went out — pushed to Shopify, or label printed —
 * on a waybill whose collection date isn't the day it went out, or whose APC
 * tracking says CANCELLED / DISPOSED OF. #136845 (booked 7 Oct, pushed 15 Oct,
 * cancelled in APC 7 Oct) is exactly what it catches. Also lists old bookings
 * the app retired (reschedule, another day's booking) that may still be live
 * at APC, so a manager can decide whether to cancel them there.
 *
 * Runs at 17:30 London every day (after packing), and on demand from the
 * APC consignment check page. Talks to APC only through read-only tracking
 * GETs. Tells Graeme through the app's notification bell when it finds a
 * row it hasn't told him about before.
 *
 * The rules are pure (apc-consignment-reuse.ts); this is the database half.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { schedule } from "node-cron";
import { isStaging } from "./app-env";
import { FOUNDER_EMAIL } from "./founder-email";
import { liveStatusOf, markCancelledInApc } from "./apc-consignment-ledger";
import {
  collectionDateOf, consignmentMismatches, mismatchLabel, mismatchNotificationText, usedDateOf,
  type MismatchKind, type UsedConsignmentRow,
} from "./apc-consignment-reuse";
import { londonDateString } from "./london-time";

const LAST_RUN_KEY = "apc_consignment_check_last_run";
/** Most tracking reads one run may make. A normal day is ~100-150. */
const MAX_APC_READS = 400;
const APC_READ_CONCURRENCY = 4;
const APC_READ_TIMEOUT_MS = 6000;

type DbRow = {
  id: number;
  waybill: string;
  shopify_order_id: string | number | null;
  shopify_order_name: string | null;
  customer_name: string | null;
  current_tags: string | null;
  collection_date: string | null;
  created_at: Date | string | null;
  dispatch_tag: string | null;
  cancelled_at: Date | string | null;
  cancelled_reason: string | null;
  superseded_at: Date | string | null;
  superseded_reason: string | null;
  pushed_to_shopify_at: Date | string | null;
  label_printed_at: Date | string | null;
  apc_status: string | null;
  apc_status_code: string | null;
  apc_dead_status: string | null;
  apc_status_checked_at: Date | string | null;
  apc_cancel_decision: string | null;
  apc_cancel_decided_by: string | null;
  apc_cancel_decided_at: Date | string | null;
  mismatch_notified_at: Date | string | null;
};

export interface CheckRow {
  waybill: string;
  orderId: number | null;
  orderName: string | null;
  customerName: string | null;
  /** The delivery date the booking was made under. */
  bookedForDeliveryDate: string | null;
  /** The order's delivery-date tag now (from the local Shopify mirror). */
  currentDeliveryDate: string | null;
  collectionDate: string | null;
  bookedAt: string | null;
  /** The day it actually went out — pushed to Shopify, else label printed. */
  dispatchDate: string | null;
  pushedToShopifyAt: string | null;
  apcStatus: string | null;
  apcDeadStatus: string | null;
  apcStatusCheckedAt: string | null;
  cancelledReason: string | null;
  supersededReason: string | null;
  problems: Array<{ kind: MismatchKind; label: string }>;
  cancelDecision: string | null;
  cancelDecidedBy: string | null;
}

export interface CheckReport {
  ranAt: string | null;
  days: number;
  checkedRows: number;
  apcReads: number;
  apcUnreachable: number;
  mismatches: CheckRow[];
  oldBookings: CheckRow[];
}

const iso = (v: Date | string | null | undefined) => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function dateTagOf(tags: string | null): string | null {
  return (tags ?? "").split(",").map(t => t.trim()).find(t => /^\d{4}-\d{2}-\d{2}$/.test(t)) ?? null;
}

function toUsed(r: DbRow): UsedConsignmentRow {
  return {
    waybill: String(r.waybill),
    collectionDate: r.collection_date ? String(r.collection_date).slice(0, 10) : null,
    createdAt: r.created_at,
    dispatchTag: r.dispatch_tag,
    cancelledAt: r.cancelled_at,
    supersededAt: r.superseded_at,
    orderId: r.shopify_order_id == null ? null : Number(r.shopify_order_id),
    orderName: r.shopify_order_name,
    pushedToShopifyAt: r.pushed_to_shopify_at,
    labelPrintedAt: r.label_printed_at,
    apcStatus: r.apc_status,
    apcDeadStatus: r.apc_dead_status,
  };
}

function toCheckRow(r: DbRow): CheckRow {
  const used = toUsed(r);
  return {
    waybill: used.waybill,
    orderId: used.orderId,
    orderName: used.orderName,
    customerName: r.customer_name,
    bookedForDeliveryDate: r.dispatch_tag,
    currentDeliveryDate: dateTagOf(r.current_tags),
    collectionDate: collectionDateOf(used),
    bookedAt: iso(r.created_at),
    dispatchDate: usedDateOf(used),
    pushedToShopifyAt: iso(r.pushed_to_shopify_at),
    apcStatus: r.apc_status,
    apcDeadStatus: r.apc_dead_status,
    apcStatusCheckedAt: iso(r.apc_status_checked_at),
    cancelledReason: r.cancelled_reason,
    supersededReason: r.superseded_reason,
    problems: consignmentMismatches(used).map(kind => ({ kind, label: mismatchLabel(kind) })),
    cancelDecision: r.apc_cancel_decision,
    cancelDecidedBy: r.apc_cancel_decided_by,
  };
}

const SELECT_ROWS = sql`
  SELECT c.id, c.waybill, c.shopify_order_id, c.shopify_order_name,
    COALESCE(NULLIF(c.consignee_name, ''), o.payload->'shipping_address'->>'name',
      NULLIF(TRIM(CONCAT(o.payload->'customer'->>'first_name', ' ', o.payload->'customer'->>'last_name')), '')) AS customer_name,
    o.payload->>'tags' AS current_tags,
    c.collection_date::text AS collection_date, c.created_at, c.dispatch_tag,
    c.cancelled_at, c.cancelled_reason, c.superseded_at, c.superseded_reason,
    c.pushed_to_shopify_at, c.label_printed_at,
    c.apc_status, c.apc_status_code, c.apc_dead_status, c.apc_status_checked_at,
    c.apc_cancel_decision, c.apc_cancel_decided_by, c.apc_cancel_decided_at, c.mismatch_notified_at
  FROM apc_consignments c
  LEFT JOIN shopify_orders_cache o ON o.id = c.shopify_order_id
`;

/** Rows that went out in the window, plus retired bookings with no decision. */
async function loadRows(days: number): Promise<{ used: DbRow[]; retired: DbRow[] }> {
  const used = await db.execute<DbRow>(sql`
    ${SELECT_ROWS}
    WHERE COALESCE(c.pushed_to_shopify_at, c.label_printed_at) >= NOW() - (${days} * INTERVAL '1 day')
    ORDER BY COALESCE(c.pushed_to_shopify_at, c.label_printed_at) DESC
  `);
  const retired = await db.execute<DbRow>(sql`
    ${SELECT_ROWS}
    WHERE c.superseded_at IS NOT NULL AND c.cancelled_at IS NULL
      AND c.apc_cancel_decision IS NULL
      AND c.pushed_to_shopify_at IS NULL
      AND c.superseded_at >= NOW() - (${Math.max(days, 30)} * INTERVAL '1 day')
    ORDER BY c.superseded_at DESC
  `);
  return { used: used.rows, retired: retired.rows };
}

async function readApcStatuses(waybills: string[], apiBase: string | undefined): Promise<{ reads: number; unreachable: number }> {
  const queue = waybills.slice(0, MAX_APC_READS);
  let reads = 0;
  let unreachable = 0;
  const worker = async () => {
    for (;;) {
      const w = queue.shift();
      if (!w) return;
      const s = await liveStatusOf(w, apiBase, APC_READ_TIMEOUT_MS);
      reads++;
      if (s.kind === "unreachable") unreachable++;
      if (s.kind === "ok" && s.dead) {
        // Our ledger should say what APC says.
        try { await markCancelledInApc(w); } catch { /* logged inside; the report still shows it */ }
      }
    }
  };
  await Promise.all(Array.from({ length: APC_READ_CONCURRENCY }, worker));
  return { reads, unreachable };
}

async function apcBaseForChecks(): Promise<string | undefined> {
  const r = await db.execute<{ value: string | null }>(sql`SELECT value FROM app_settings WHERE key = 'apc_test_mode'`);
  if (r.rows[0]?.value === "true") {
    const { APC_TRAINING_BASE } = await import("../services/apc");
    return APC_TRAINING_BASE;
  }
  return undefined;
}

/** Read APC for a row went out in the last two days, or is already
 *  flagged — unless it was read in the last six hours or is already dead. */
function needsRead(r: DbRow, sinceIso: string): boolean {
  if (r.apc_dead_status) return false; // dead is final
  const used = toUsed(r);
  const mismatched = consignmentMismatches(used).length > 0;
  const recent = (usedDateOf(used) ?? "") >= sinceIso;
  const checked = r.apc_status_checked_at ? new Date(r.apc_status_checked_at as string).getTime() : 0;
  const stale = Date.now() - checked > 6 * 60 * 60_000;
  return stale && (recent || mismatched);
}

let running: Promise<CheckReport> | null = null;

/**
 * Run the check. `readApc` false = report from what we already know (the
 * page's plain load); true = refresh APC statuses first (daily job, and the
 * page's "Check APC now" button).
 */
export async function runConsignmentCheck(opts: { days?: number; readApc: boolean; notify: boolean }): Promise<CheckReport> {
  if (opts.readApc && running) return running;
  const job = (async () => {
    const days = Math.min(Math.max(opts.days ?? 45, 1), 120);
    let apcReads = 0;
    let apcUnreachable = 0;
    if (opts.readApc) {
      const since = londonDateString(new Date(Date.now() - 2 * 86_400_000));
      const first = await loadRows(days);
      const toRead = [...new Set([
        ...first.used.filter(r => needsRead(r, since)).map(r => String(r.waybill)),
        ...first.retired.filter(r => !r.apc_dead_status).map(r => String(r.waybill)),
      ])];
      const res = await readApcStatuses(toRead, await apcBaseForChecks());
      apcReads = res.reads;
      apcUnreachable = res.unreachable;
    }
    const { used, retired } = await loadRows(days);
    const flagged = used.filter(r => consignmentMismatches(toUsed(r)).length > 0);
    const report: CheckReport = {
      ranAt: new Date().toISOString(),
      days,
      checkedRows: used.length,
      apcReads,
      apcUnreachable,
      mismatches: flagged.map(toCheckRow),
      // An old booking APC already says is dead needs no decision.
      oldBookings: retired.filter(r => !r.apc_dead_status).map(toCheckRow),
    };
    if (opts.readApc) {
      await saveLastRun(report);
      if (opts.notify) await notifyNew(flagged);
    }
    return report;
  })();
  if (opts.readApc) {
    running = job;
    try { return await job; } finally { running = null; }
  }
  return job;
}

async function saveLastRun(r: CheckReport): Promise<void> {
  const value = JSON.stringify({ ranAt: r.ranAt, checkedRows: r.checkedRows, apcReads: r.apcReads, apcUnreachable: r.apcUnreachable, found: r.mismatches.length, oldBookings: r.oldBookings.length });
  try {
    await db.execute(sql`
      INSERT INTO app_settings (key, value) VALUES (${LAST_RUN_KEY}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `);
  } catch (err) {
    console.warn("[apc-check] could not save last run:", err instanceof Error ? err.message : err);
  }
}

export async function lastRun(): Promise<{ ranAt: string; checkedRows: number; apcReads: number; apcUnreachable: number; found: number; oldBookings: number } | null> {
  const r = await db.execute<{ value: string | null }>(sql`SELECT value FROM app_settings WHERE key = ${LAST_RUN_KEY}`);
  try { return r.rows[0]?.value ? JSON.parse(r.rows[0].value) : null; } catch { return null; }
}

/** One bell for Graeme per run, naming only rows he hasn't been told about. */
async function notifyNew(flagged: DbRow[]): Promise<void> {
  const fresh = flagged.filter(r => !r.mismatch_notified_at);
  if (!fresh.length) return;
  try {
    const u = await db.execute<{ id: number }>(sql`SELECT id FROM app_users WHERE lower(email) = lower(${FOUNDER_EMAIL}) LIMIT 1`);
    const userId = u.rows[0]?.id;
    if (!userId) {
      console.warn("[apc-check] founder account not found — no notification sent");
      return;
    }
    const message = mismatchNotificationText(fresh.map(r => ({ orderName: r.shopify_order_name, waybill: String(r.waybill) })));
    await db.execute(sql`
      INSERT INTO notifications (user_id, type, message, read)
      VALUES (${userId}, ${"apc_mismatch"}, ${message.slice(0, 500)}, false)
    `);
    await db.execute(sql`
      UPDATE apc_consignments SET mismatch_notified_at = NOW()
      WHERE id IN (${sql.join(fresh.map(r => sql`${r.id}`), sql`, `)})
    `);
    console.log(`[apc-check] told Graeme about ${fresh.length} consignment(s): ${fresh.map(r => r.shopify_order_name).join(", ")}`);
  } catch (err) {
    console.error("[apc-check] notification failed:", err instanceof Error ? err.message : err);
  }
}

/** 17:30 London, every day — after the day's packing. Off on staging (a
 *  copy of the live database must not raise live notifications). */
export function startConsignmentCheckScheduler(): void {
  if (isStaging()) {
    console.log("[apc-check] staging: daily consignment check disabled");
    return;
  }
  schedule("30 17 * * *", () => {
    void runConsignmentCheck({ readApc: true, notify: true })
      .then(r => console.log(`[apc-check] daily: ${r.checkedRows} checked, ${r.apcReads} APC reads (${r.apcUnreachable} unreachable), ${r.mismatches.length} problem(s), ${r.oldBookings.length} old booking(s) to decide`))
      .catch(err => console.error("[apc-check] daily run failed:", err instanceof Error ? err.message : err));
  }, { timezone: "Europe/London" });
  console.log("[apc-check] daily consignment check scheduled 17:30 Europe/London");
}
