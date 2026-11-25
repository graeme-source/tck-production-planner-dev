// Loads everything the profit tracker needs (Objective I). Read only:
// the Shopify orders mirror (no Shopify crawl), QuickBooks' P&L by month,
// Planday wages, and the Meta + Google spend already synced for the Ads page.
// The maths is in profit-tracker.ts.
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ensureOrdersFresh } from "../orders-cache";
import { addDaysToDateString, londonDateString, londonDaysWindowUtc } from "../london-time";
import { loadVariantCosting } from "../pnl-calculator";
import { getPayrollCosts } from "../../services/planday";
import { loadSpendDays } from "../ad-spend-days";
import { loadPnlByMonth } from "./qbo-pnl-by-month-load";
import {
  BUCKETS, bucketTotals, byProduct, bySize, calibrate, compareMonth, costOrder, isBucket, orderRows, periodPnl, resolveBuckets,
  type AccountBucket, type Bucket, type Calibration, type CompareRow, type CostRates, type GroupSummary, type OrderRow,
  type PeriodPnl, type ProductSummary, type TrackerOrder,
} from "./profit-tracker";

// ── Settings ────────────────────────────────────────────────────────────

export const TRACKER_SETTINGS = {
  small_box_cost: 2.5,
  large_box_cost: 3.5,
  small_box_courier: 4.72,
  large_box_courier: 5.72,
  overhead_average_months: 3,
  // Contribution margin an order should make (%), before labour, for the
  // order table's colours (Graeme, 24 Nov 2026).
  target_order_margin: 60,
  // Employer on-costs Planday's wages are grossed up by (services/planday.ts
  // reads the same keys) — moved here from the old P&L settings panel.
  employer_ni_rate: 15,
  employer_ni_weekly_threshold: 96.15,
  employment_allowance_annual: 10500,
  employer_pension_rate: 3,
} as const;
export type TrackerSettingKey = keyof typeof TRACKER_SETTINGS;

export async function readTrackerSettings(): Promise<Record<TrackerSettingKey, number> & { weightThresholdGrams: number }> {
  const rows = await db.execute<{ key: string; value: string }>(sql`SELECT key, value FROM pnl_settings`);
  const got = new Map(rows.rows.map(r => [r.key, Number(r.value)]));
  const out = {} as Record<TrackerSettingKey, number>;
  for (const k of Object.keys(TRACKER_SETTINGS) as TrackerSettingKey[]) {
    const v = got.get(k);
    out[k] = v != null && Number.isFinite(v) ? v : TRACKER_SETTINGS[k];
  }
  const t = await db.execute<{ value: string }>(sql`SELECT value FROM app_settings WHERE key = 'apc_weight_threshold_grams' LIMIT 1`);
  return { ...out, weightThresholdGrams: Number(t.rows[0]?.value) || 7001 };
}

export async function writeTrackerSetting(key: TrackerSettingKey, value: number): Promise<void> {
  const v = String(value);
  const done = await db.execute(sql`UPDATE pnl_settings SET value = ${v}, updated_at = NOW() WHERE key = ${key}`);
  if ((done.rowCount ?? 0) === 0) await db.execute(sql`INSERT INTO pnl_settings (key, value) VALUES (${key}, ${v})`);
}

// ── QuickBooks: account buckets and calibration ─────────────────────────

async function chosenBuckets(): Promise<Map<string, Bucket>> {
  const rows = await db.execute<{ account_key: string; bucket: string }>(sql`SELECT account_key, bucket FROM pnl_account_buckets`);
  return new Map(rows.rows.filter(r => isBucket(r.bucket)).map(r => [r.account_key, r.bucket as Bucket]));
}

export async function setAccountBucket(name: string, key: string, bucket: Bucket | null, byName: string | null): Promise<void> {
  if (bucket == null) {
    await db.execute(sql`DELETE FROM pnl_account_buckets WHERE account_key = ${key}`);
    return;
  }
  await db.execute(sql`
    INSERT INTO pnl_account_buckets (account_key, account_name, bucket, updated_by_name, updated_at)
    VALUES (${key}, ${name}, ${bucket}, ${byName}, NOW())
    ON CONFLICT (account_key) DO UPDATE SET account_name = EXCLUDED.account_name, bucket = EXCLUDED.bucket,
      updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()
  `);
}

/** The last `n` complete months before today's month, oldest first (YYYY-MM). */
export function lastCompleteMonths(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - n + i, 1)).toISOString().slice(0, 7));
}

export interface QboBuckets {
  months: string[];
  accounts: AccountBucket[];
  totals: Record<Bucket, number[]>;
  calibration: Calibration;
}

export async function loadQboBuckets(months: string[], opts: { fresh?: boolean } = {}): Promise<QboBuckets> {
  const [report, chosen] = await Promise.all([
    loadPnlByMonth(months[0]!, months[months.length - 1]!, opts),
    chosenBuckets(),
  ]);
  const accounts = resolveBuckets(report.lines, chosen);
  const totals = bucketTotals(accounts, report.months.length);
  return { months: report.months.map(m => m.key), accounts, totals, calibration: calibrate(totals, report.months.map(m => m.key)) };
}

// ── Orders ──────────────────────────────────────────────────────────────

/** Uncancelled orders placed on London days from..to, with only the fields
 *  the tracker reads — a month of full payloads is too heavy to parse. */
export async function loadTrackerOrders(from: string, to: string): Promise<TrackerOrder[]> {
  await ensureOrdersFresh(addDaysToDateString(from, -1));
  const { start, end } = londonDaysWindowUtc(from, to);
  const rows = await db.execute<{
    id: string; name: string; created_at: string; tags: string | null;
    total_price: string; subtotal_price: string; total_tax: string; total_discounts: string; total_weight: string;
    refunded: string; lines: Array<{ variantId: string | null; title: string | null; variantTitle: string | null; quantity: number; price: string | number; discount: string | number; requiresShipping?: boolean | null; giftCard?: boolean | null }>;
  }>(sql`
    SELECT id::text AS id,
           payload->>'name' AS name,
           payload->>'created_at' AS created_at,
           payload->>'tags' AS tags,
           COALESCE((payload->>'total_price')::numeric, 0) AS total_price,
           COALESCE((payload->>'subtotal_price')::numeric, 0) AS subtotal_price,
           COALESCE((payload->>'total_tax')::numeric, 0) AS total_tax,
           COALESCE((payload->>'total_discounts')::numeric, 0) AS total_discounts,
           COALESCE((payload->>'total_weight')::numeric, 0) AS total_weight,
           COALESCE((
             SELECT SUM((t->>'amount')::numeric)
               FROM jsonb_array_elements(COALESCE(payload->'refunds', '[]'::jsonb)) r,
                    jsonb_array_elements(COALESCE(r->'transactions', '[]'::jsonb)) t
              WHERE t->>'kind' = 'refund' AND t->>'status' = 'success'
           ), 0) AS refunded,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'variantId', li->>'variant_id',
                      'title', li->>'title',
                      'variantTitle', li->>'variant_title',
                      'requiresShipping', (li->>'requires_shipping')::boolean,
                      'giftCard', (li->>'gift_card')::boolean,
                      'quantity', COALESCE((li->>'quantity')::int, 0),
                      'price', COALESCE((li->>'price')::numeric, 0),
                      'discount', COALESCE((
                        SELECT SUM((d->>'amount')::numeric)
                          FROM jsonb_array_elements(COALESCE(li->'discount_allocations', '[]'::jsonb)) d
                      ), 0)))
               FROM jsonb_array_elements(COALESCE(payload->'line_items', '[]'::jsonb)) li
           ), '[]'::jsonb) AS lines
      FROM shopify_orders_cache
     WHERE created_at >= ${start.toISOString()}::timestamptz
       AND created_at < ${end.toISOString()}::timestamptz
       AND payload->>'cancelled_at' IS NULL
     ORDER BY created_at
  `);
  return rows.rows.map(r => ({
    id: Number(r.id),
    name: r.name,
    createdAt: r.created_at,
    cancelledAt: null,
    tags: r.tags,
    totalPrice: Number(r.total_price),
    subtotalPrice: Number(r.subtotal_price),
    totalTax: Number(r.total_tax),
    totalDiscounts: Number(r.total_discounts),
    totalWeight: Number(r.total_weight),
    refunded: Number(r.refunded),
    lines: (r.lines ?? []).map(l => ({
      variantId: l.variantId,
      title: l.title ?? "",
      variantTitle: l.variantTitle,
      quantity: Number(l.quantity) || 0,
      price: Number(l.price) || 0,
      discount: Number(l.discount) || 0,
      requiresShipping: l.requiresShipping ?? null,
      giftCard: l.giftCard ?? null,
    })),
  }));
}

// ── The prediction ──────────────────────────────────────────────────────

export interface Prediction {
  from: string;
  to: string;
  days: number;
  pnl: PeriodPnl;
  orders: OrderRow[];
  bySize: GroupSummary[];
  byProduct: ProductSummary[];
  calibration: Calibration;
  rates: CostRates;
}

function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

async function plandayLabour(from: string, to: string): Promise<number | null> {
  try {
    const r = await getPayrollCosts(from, to);
    return r.available ? r.totalCost : null;
  } catch (err) {
    console.warn("[profit-tracker] Planday read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function adSpend(from: string, to: string): Promise<number> {
  const { days } = await loadSpendDays(from, to);
  return days.reduce((t, d) => t + (d.amount ?? 0), 0);
}

export async function predict(from: string, to: string, calibration: Calibration): Promise<Prediction> {
  const settings = await readTrackerSettings();
  const rates: CostRates = {
    smallBox: settings.small_box_cost,
    largeBox: settings.large_box_cost,
    smallCourier: settings.small_box_courier,
    largeCourier: settings.large_box_courier,
    weightThresholdGrams: settings.weightThresholdGrams,
    paymentFeeRate: calibration.paymentFeeRate,
  };
  const [orders, labour, advertising] = await Promise.all([
    loadTrackerOrders(from, to),
    plandayLabour(from, to),
    adSpend(from, to),
  ]);
  const variants = new Map<string, string>();
  for (const o of orders) for (const l of o.lines) if (l.variantId && !variants.has(l.variantId)) variants.set(l.variantId, l.title);
  const costing = await loadVariantCosting([...variants].map(([variantId, title]) => ({ variantId, title })));

  const londonDay = (iso: string) => londonDateString(new Date(iso));
  const econ = orders.map(o => costOrder(o, costing, rates, londonDay));
  const days = daysInclusive(from, to);
  const pnl = periodPnl(econ, { days, labour, advertising, calibration });
  const rows = orderRows(econ, pnl);
  return {
    from, to, days, pnl,
    orders: rows,
    bySize: bySize(rows),
    byProduct: byProduct(rows, orders, costing),
    calibration,
    rates,
  };
}

// ── Predicted vs QuickBooks, by complete month ──────────────────────────

export interface MonthComparison {
  month: string;
  rows: CompareRow[];
}

export async function compareMonths(qbo: QboBuckets): Promise<MonthComparison[]> {
  const out: MonthComparison[] = [];
  // One month at a time: each reads a month of orders and Planday.
  for (let i = 0; i < qbo.months.length; i++) {
    const month = qbo.months[i]!;
    const from = `${month}-01`;
    const [y, m] = month.split("-").map(Number) as [number, number];
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const p = await predict(from, to, qbo.calibration);
    const actual = Object.fromEntries(BUCKETS.map(b => [b, qbo.totals[b][i] ?? 0])) as Record<Bucket, number>;
    out.push({ month, rows: compareMonth(p.pnl, actual) });
  }
  return out;
}
