/**
 * Loads the month-end adjustments (deferred income + 25th → month-end
 * labour) and the history from 31 Mar 2025. The rules are in month-end.ts
 * (pure, tested); this file only gathers inputs. Objective I.
 *
 * READ-ONLY towards Shopify and Planday: every call is a GET. It writes
 * only to our own tables — the Shopify orders mirror (shopify_orders_cache,
 * refreshed with Shopify's own data) and month_end_adjustments (a cache of
 * final results, migration 0342).
 *
 * Dispatch records joined per order:
 *   · shopify_orders_cache.payload.fulfillments — Shopify's fulfilments.
 *     Rows saved before 27 Oct 2026 may lack them (orders-cache.ts), so any
 *     order Shopify calls fulfilled with no fulfilment data AND no app/APC
 *     record is re-read from Shopify first (refreshOrdersByIds).
 *   · shopify_fulfilment_tracking (source 'immediate') — the app's fulfil
 *     record. fulfilled_at is a timestamp WITHOUT time zone holding UTC
 *     (measured: 2 s from Shopify's fulfilment when read as UTC, exactly an
 *     hour out when read as London). 'startup-seed' / 'poller' rows are
 *     processing times, not fulfilment times, so they're not used.
 *   · apc_consignments — live bookings only (not cancelled or superseded);
 *     collection_date is the day APC took it.
 * Not used: dispatch_orders and case_orders (both empty on live, 27 Oct
 * 2026), collections (wholesale supplier pick-ups, not Shopify orders) and
 * packing scans (packing_batch_records is per recipe batch, not per order).
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ensureOrdersFresh, refreshOrdersByIds } from "../orders-cache";
import { addDaysToDateString, londonDateString } from "../london-time";
import {
  getEmployerCostSettings, getPlandayAbsenceAccounts, getPlandayAbsenceRecords, getPlandayPayrollRows,
  getPlandayPositions, getPlandaySections, isPlandayConfigured,
} from "../../services/planday";
import { assemblePayroll } from "./report-data";
import { payPeriodLabel } from "./period";
import {
  HISTORY_START, LOOKBACK_DAYS, chainHistory, computeDeferredIncome, deferralOrderFromShopify, isFinal,
  labourWindow, latestClosedMonthEnd, monthEndCutoff, monthEndsBetween, monthLabel, payPeriodForMonthEnd,
  summariseMonthEndLabour, type DeferralOrder, type DeferredIncome, type HistoryPoint, type HistoryRow,
  type MonthEndLabour, type ShopifyOrderPayload,
} from "./month-end";

export interface MonthEndResult {
  monthEnd: string;
  label: string;
  payPeriod: { from: string; to: string; label: string };
  deferred: DeferredIncome | null;
  deferredError: string | null;
  labour: MonthEndLabour | null;
  labourError: string | null;
  /** The pay period holding its labour is over; stored and reused. */
  final: boolean;
  computedAt: string;
  fromStore: boolean;
}

export interface LoadOptions {
  /** false = no Shopify calls at all (local checks): read the mirror as is. */
  shopify?: boolean;
  /** Ignore a stored result and work it out again. */
  force?: boolean;
  computedByName?: string | null;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isoOf = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ── Deferred income ───────────────────────────────────────────────────────

interface OrderRow extends Record<string, unknown> { id: string; payload: ShopifyOrderPayload }

async function readMirror(fromUtc: Date, cutoff: Date): Promise<OrderRow[]> {
  const r = await db.execute<OrderRow>(sql`
    SELECT id::text AS id, payload FROM shopify_orders_cache
     WHERE created_at >= ${fromUtc.toISOString()}::timestamptz AND created_at < ${cutoff.toISOString()}::timestamptz
  `);
  return r.rows;
}

async function dispatchRecords(ids: number[]): Promise<{ app: Map<number, string>; apc: Map<number, string> }> {
  const app = new Map<number, string>();
  const apc = new Map<number, string>();
  if (ids.length === 0) return { app, apc };
  const list = sql.join(ids.map(i => sql`${i}`), sql`, `);
  const a = await db.execute<{ id: string; at: unknown }>(sql`
    SELECT shopify_order_id::text AS id, MIN(fulfilled_at AT TIME ZONE 'UTC') AS at
      FROM shopify_fulfilment_tracking
     WHERE source = 'immediate' AND shopify_order_id IN (${list})
     GROUP BY shopify_order_id
  `);
  for (const r of a.rows) { const at = isoOf(r.at); if (at) app.set(Number(r.id), at); }
  const c = await db.execute<{ id: string; day: string }>(sql`
    SELECT shopify_order_id::text AS id, to_char(MIN(collection_date), 'YYYY-MM-DD') AS day
      FROM apc_consignments
     WHERE shopify_order_id IN (${list}) AND cancelled_at IS NULL AND superseded_at IS NULL AND collection_date IS NOT NULL
     GROUP BY shopify_order_id
  `);
  for (const r of c.rows) if (r.day) apc.set(Number(r.id), r.day);
  return { app, apc };
}

export async function loadDeferredIncome(monthEnd: string, opts: LoadOptions = {}): Promise<DeferredIncome> {
  const cutoff = monthEndCutoff(monthEnd);
  const fromUtc = new Date(cutoff.getTime() - LOOKBACK_DAYS * 86_400_000);
  const warnings: string[] = [];
  if (opts.shopify !== false) {
    // Brings the mirror up to date and back-fills it to the look-back if it
    // doesn't reach that far yet (one-off, read-only Shopify fetch).
    await ensureOrdersFresh(addDaysToDateString(londonDateString(fromUtc), -1));
  }
  let rows = await readMirror(fromUtc, cutoff);
  if (rows.length === 0) throw new Error(`No Shopify orders in the mirror for the ${LOOKBACK_DAYS} days to ${monthLabel(monthEnd)}'s end.`);
  let { app, apc } = await dispatchRecords(rows.map(r => Number(r.id)));

  // Orders Shopify calls sent, with no fulfilment data saved and no record
  // of our own: ask Shopify for them again.
  const missing = rows.filter(r => {
    const p = r.payload;
    const id = Number(r.id);
    return p.fulfillments == null && !app.has(id) && !apc.has(id)
      && ["fulfilled", "partial"].includes((p.fulfillment_status ?? "").toLowerCase());
  }).map(r => Number(r.id));
  if (missing.length > 0 && opts.shopify !== false) {
    try {
      await refreshOrdersByIds(missing);
      rows = await readMirror(fromUtc, cutoff);
      ({ app, apc } = await dispatchRecords(rows.map(r => Number(r.id))));
    } catch (e) {
      warnings.push(`Couldn't re-read ${missing.length} order${missing.length === 1 ? "" : "s"} from Shopify for their dispatch dates (${errText(e)}) — those use the delivery-date estimate.`);
    }
  }

  const orders: DeferralOrder[] = rows.map(r => deferralOrderFromShopify(r.payload, {
    appFulfilledAt: app.get(Number(r.id)) ?? null,
    apcCollectionDate: apc.get(Number(r.id)) ?? null,
  }));
  const d = computeDeferredIncome(monthEnd, orders);
  d.warnings.push(...warnings);
  return d;
}

// ── Labour ────────────────────────────────────────────────────────────────

export async function loadMonthEndLabour(monthEnd: string, today = londonDateString()): Promise<MonthEndLabour> {
  if (!isPlandayConfigured()) throw new Error("Planday isn't connected.");
  const w = labourWindow(monthEnd);
  const [rows, absenceRecords, absenceAccounts, positions, sections, settings] = await Promise.all([
    getPlandayPayrollRows(w.from, w.to),
    getPlandayAbsenceRecords(w.from, w.to),
    getPlandayAbsenceAccounts(),
    getPlandayPositions(),
    getPlandaySections(),
    getEmployerCostSettings().catch(() => null),
  ]);
  if (rows == null) throw new Error(`Couldn't get payroll from Planday for ${w.from} to ${w.to}.`);
  // The payroll report's own rules, run over the 25th → month-end window.
  const data = assemblePayroll({
    period: { from: w.from, to: w.to, label: payPeriodLabel(w.from, w.to) },
    payrollRows: rows,
    employees: [],
    deactivatedEmployees: null,
    listLeavers: false,
    absenceRecords,
    absenceAccounts,
    contracts: [],
    appUsers: [],
    positions,
    sections,
  });
  return summariseMonthEndLabour(monthEnd, data, settings, today);
}

// ── One month end, stored once final ─────────────────────────────────────

interface StoredRow extends Record<string, unknown> { deferred: DeferredIncome; labour: MonthEndLabour; computed_at: unknown }

async function readStored(monthEnd: string): Promise<StoredRow | null> {
  try {
    const r = await db.execute<StoredRow>(sql`SELECT deferred, labour, computed_at FROM month_end_adjustments WHERE month_end = ${monthEnd}`);
    return r.rows[0] ?? null;
  } catch (e) {
    // Table not there yet (migration 0342 not applied): just work it out.
    console.warn("[month-end] stored results unavailable:", errText(e));
    return null;
  }
}

async function store(monthEnd: string, deferred: DeferredIncome, labour: MonthEndLabour, by: string | null): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO month_end_adjustments (month_end, deferred, labour, computed_at, computed_by_name)
      VALUES (${monthEnd}, ${JSON.stringify(deferred)}::jsonb, ${JSON.stringify(labour)}::jsonb, NOW(), ${by})
      ON CONFLICT (month_end) DO UPDATE SET deferred = EXCLUDED.deferred, labour = EXCLUDED.labour,
        computed_at = NOW(), computed_by_name = EXCLUDED.computed_by_name
    `);
  } catch (e) {
    console.warn("[month-end] couldn't store result:", errText(e));
  }
}

export async function getMonthEnd(monthEnd: string, opts: LoadOptions = {}, today = londonDateString()): Promise<MonthEndResult> {
  const pp = payPeriodForMonthEnd(monthEnd);
  const final = isFinal(monthEnd, today);
  const base = { monthEnd, label: monthLabel(monthEnd), payPeriod: pp, final };
  if (final && !opts.force) {
    const s = await readStored(monthEnd);
    if (s) {
      return { ...base, deferred: s.deferred, deferredError: null, labour: s.labour, labourError: null, computedAt: isoOf(s.computed_at) ?? "", fromStore: true };
    }
  }
  const [deferred, labour] = await Promise.allSettled([loadDeferredIncome(monthEnd, opts), loadMonthEndLabour(monthEnd, today)]);
  const out: MonthEndResult = {
    ...base,
    deferred: deferred.status === "fulfilled" ? deferred.value : null,
    deferredError: deferred.status === "rejected" ? errText(deferred.reason) : null,
    labour: labour.status === "fulfilled" ? labour.value : null,
    labourError: labour.status === "rejected" ? errText(labour.reason) : null,
    computedAt: new Date().toISOString(),
    fromStore: false,
  };
  if (final && out.deferred && out.labour) await store(monthEnd, out.deferred, out.labour, opts.computedByName ?? null);
  return out;
}

// ── History ──────────────────────────────────────────────────────────────

export interface MonthEndHistory {
  first: string;
  last: string;
  rows: HistoryRow[];
}

/** Every month end from 31 Mar 2025 to the latest finished month, one at a
 *  time (kind to Shopify and Planday). The first run on live back-fills
 *  the orders mirror to Dec 2024 and stores each final month end; after
 *  that it's read from the store. */
export async function getMonthEndHistory(opts: LoadOptions = {}, today = londonDateString()): Promise<MonthEndHistory> {
  const last = latestClosedMonthEnd(today);
  const ends = monthEndsBetween(HISTORY_START, last);
  const points: HistoryPoint[] = [];
  for (const me of ends) {
    const r = await getMonthEnd(me, opts, today);
    const notes: string[] = [];
    if (r.deferred) notes.push(r.deferred.trust.summary);
    if (r.deferred?.bySource.estimate.orders) notes.push(`${r.deferred.bySource.estimate.orders} deferred order(s) dated by estimate.`);
    if (r.deferred?.unknown.orders) notes.push(`${r.deferred.unknown.orders} sent order(s) with no dispatch date left out.`);
    if (r.labour?.provisional) notes.push("Labour provisional: pay period not over.");
    if (r.labour?.holidayByHand) notes.push(`${r.labour.holidayByHand} person/people's holiday priced by hand.`);
    const error = [r.deferredError && `Deferred income: ${r.deferredError}`, r.labourError && `Labour: ${r.labourError}`].filter(Boolean).join(" ") || null;
    points.push({
      monthEnd: me,
      deferred: r.deferred ? { incVat: r.deferred.incVat, exVat: r.deferred.exVat, orders: r.deferred.orders } : null,
      labour: r.labour ? { pay: r.labour.pay, hours: r.labour.hours, employer: r.labour.employer?.total ?? null } : null,
      trustworthy: r.deferred ? r.deferred.trust.trustworthy : null,
      notes,
      error,
    });
  }
  return { first: HISTORY_START, last, rows: chainHistory(points) };
}
