/**
 * Team efficiency — the job that fills team_efficiency_days (Objective I).
 *
 *   - Nightly (first hourly tick after 02:00 London): recomputes the last
 *     RECENT_DAYS production days, so shifts approved late still land.
 *   - Backfill: on first boot after deploy, computes up to 12 months back —
 *     as far as production records exist — oldest first, in ≤ 28-day
 *     Planday windows. Recorded as done in team_efficiency_settings
 *     (job_backfill); an interrupted backfill simply resumes next boot.
 *   - A founder settings change restates stored history (no Planday), except
 *     line positions / holiday accrual, which recompute from Planday.
 *
 * All the rules live in pure, tested modules (lib/team-efficiency-*.ts); this
 * file only reads the database and Planday and writes rows. Planday is read
 * only. Logs carry counts and dates, never pay.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  getPlandayPayrollRows, getPlandayShifts, getPlandayPositions, getPlandaySections,
  getPlandayShiftTypes, getEmployerCostSettings, isPlandayConfigured,
} from "./planday";
import { londonDateString, londonHour } from "../lib/london-time";
import { madeByLine, deriveDay, type DayComponents, type PlanItemInput, type TeSettings, type LineMade, type LineDespatched } from "../lib/team-efficiency-day";
import {
  labourByProductionDay, weeklyOnCostMultipliers, addDaysIso, weekStart,
  type PayrollRowInput, type RotaShiftInput,
} from "../lib/team-efficiency-labour";
import { despatchByDay, type OrderInput, type RecipeInput } from "../lib/team-efficiency-despatch";
import { parseSettings } from "../lib/team-efficiency-settings";
import { onCostMultiplier } from "../lib/team-efficiency";

const CHUNK_DAYS = 28;          // Planday payroll windows stay ≤ 28 days
const RECENT_DAYS = 10;         // re-computed every night
const STALE_AFTER_DAYS = 14;    // unapproved shifts older than this are left out
const HISTORY_DAYS = 365;       // backfill depth
const ORDER_LOOKBACK_DAYS = 60; // orders are placed at most this long before despatch
const NIGHTLY_HOUR = 2;         // London

// ── Settings ──────────────────────────────────────────────────────────────

async function settingRows(): Promise<Array<{ key: string; value: unknown }>> {
  const r = await db.execute<{ key: string; value: unknown }>(sql`SELECT key, value FROM team_efficiency_settings`);
  return r.rows;
}

export async function loadSettings(): Promise<TeSettings> {
  return parseSettings(await settingRows());
}

async function readJobState(key: string): Promise<unknown> {
  const r = await db.execute<{ value: unknown }>(sql`SELECT value FROM team_efficiency_settings WHERE key = ${key}`);
  return r.rows[0]?.value ?? null;
}

async function writeJobState(key: string, value: unknown): Promise<void> {
  await db.execute(sql`
    INSERT INTO team_efficiency_settings (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
}

async function tableReady(): Promise<boolean> {
  const r = await db.execute<{ ok: string | null }>(sql`SELECT to_regclass('public.team_efficiency_days')::text AS ok`);
  return Boolean(r.rows[0]?.ok);
}

// ── Inputs ────────────────────────────────────────────────────────────────

const num = (x: unknown) => Number(x) || 0;

async function planDatesAround(from: string, to: string): Promise<string[]> {
  const r = await db.execute<{ d: string }>(sql`
    SELECT DISTINCT plan_date::text AS d FROM production_plans
    WHERE plan_date BETWEEN ${addDaysIso(from, -21)} AND ${addDaysIso(to, 21)} ORDER BY 1
  `);
  return r.rows.map(x => x.d);
}

/** Bank holidays / shutdowns — the app's own non-dispatch list, so the
 *  planner and this KPI agree on which weekdays are rest days. */
async function nonDispatchDays(): Promise<Set<string>> {
  try {
    const r = await db.execute<{ value: string | null }>(sql`SELECT value FROM app_settings WHERE key = 'non_dispatch_dates' LIMIT 1`);
    const raw = r.rows[0]?.value;
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((d: unknown): d is string => typeof d === "string") : []);
  } catch {
    return new Set();
  }
}

async function planItems(from: string, to: string): Promise<Map<string, PlanItemInput[]>> {
  const r = await db.execute<Record<string, unknown>>(sql`
    SELECT p.plan_date::text AS date, r.category, i.fridge_qty, (i.fridge_eight_pack_qty + i.freezer_eight_pack_qty) AS bags,
           i.batches_target, i.batches_complete, r.portions_per_batch, r.pack_size, r.rrp
    FROM production_plans p
    JOIN production_plan_items i ON i.plan_id = p.id
    JOIN recipes r ON r.id = i.recipe_id
    WHERE p.plan_date BETWEEN ${from} AND ${to}
  `);
  const out = new Map<string, PlanItemInput[]>();
  for (const x of r.rows) {
    const date = String(x.date);
    const list = out.get(date) ?? [];
    list.push({
      category: (x.category as string | null) || null,
      fridgeQty: num(x.fridge_qty),
      eightPackBags: num(x.bags),
      batchesTarget: num(x.batches_target),
      batchesComplete: num(x.batches_complete),
      portionsPerBatch: num(x.portions_per_batch),
      packSize: num(x.pack_size),
      rrp: num(x.rrp),
    });
    out.set(date, list);
  }
  return out;
}

async function despatchInputs(from: string, to: string) {
  const [orders, maps, recipes] = await Promise.all([
    db.execute<{ tags: string | null; fs: string | null; ca: string | null; li: unknown }>(sql`
      SELECT payload->>'tags' AS tags, payload->>'fulfillment_status' AS fs, payload->>'cancelled_at' AS ca,
             (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'v', x->>'variant_id', 'vt', x->>'variant_title', 't', x->>'title', 'q', x->>'quantity')), '[]'::jsonb)
              FROM jsonb_array_elements(coalesce(payload->'line_items', '[]'::jsonb)) x) AS li
      FROM shopify_orders_cache
      WHERE created_at >= ${addDaysIso(from, -ORDER_LOOKBACK_DAYS)}::date AND created_at < ${addDaysIso(to, 2)}::date
    `),
    db.execute<{ recipe_id: number; shopify_variant_id: string | null; shopify_product_title: string | null }>(sql`
      SELECT recipe_id, shopify_variant_id, shopify_product_title FROM recipe_shopify_mappings ORDER BY id
    `),
    db.execute<{ id: number; category: string | null; pack_size: string; rrp: string }>(sql`
      SELECT id, category, pack_size, rrp FROM recipes
    `),
  ]);
  const byVariant = new Map<string, number>();
  const byTitle = new Map<string, number>();
  for (const m of maps.rows) {
    if (m.shopify_variant_id) byVariant.set(String(m.shopify_variant_id), m.recipe_id);
    const t = (m.shopify_product_title ?? "").trim().toLowerCase();
    if (t && !byTitle.has(t)) byTitle.set(t, m.recipe_id);
  }
  const recipeMap = new Map<number, RecipeInput>(recipes.rows.map(r => [r.id, {
    id: r.id, category: r.category || null, packSize: num(r.pack_size), rrp: num(r.rrp),
  }]));
  const orderInputs: OrderInput[] = orders.rows.map(o => {
    const li = (typeof o.li === "string" ? JSON.parse(o.li) : o.li) as Array<{ v: string | null; vt: string | null; t: string | null; q: string | null }>;
    return {
      tags: o.tags, fulfillmentStatus: o.fs, cancelledAt: o.ca,
      lineItems: (li ?? []).map(x => ({ variantId: x.v, variantTitle: x.vt, title: x.t, quantity: num(x.q) })),
    };
  });
  return despatchByDay(orderInputs, byVariant, byTitle, recipeMap);
}

interface PlandayWindow {
  payroll: PayrollRowInput[];
  rota: RotaShiftInput[];
}

/** Payroll + rota for [from, to] in ≤ 28-day windows, sequentially. Throws
 *  when payroll can't be had — a day computed without its pay would be a
 *  false high. */
async function plandayWindow(from: string, to: string): Promise<PlandayWindow> {
  const payroll: PayrollRowInput[] = [];
  const rota: RotaShiftInput[] = [];
  for (let start = from; start <= to; start = addDaysIso(start, CHUNK_DAYS)) {
    const end = addDaysIso(start, CHUNK_DAYS - 1) < to ? addDaysIso(start, CHUNK_DAYS - 1) : to;
    const rows = await getPlandayPayrollRows(start, end);
    if (!rows) throw new Error(`Planday payroll unavailable for ${start} → ${end}`);
    for (const r of rows) {
      payroll.push({
        id: r.id, employeeId: r.employeeId, date: r.date, positionId: r.positionId ?? null,
        salary: r.salary, start: r.start, end: r.end, breaks: r.breaks ?? [],
      });
    }
    for (const s of await getPlandayShifts(start, end)) {
      rota.push({
        id: s.id, employeeId: s.employeeId ?? null, date: s.date, status: s.status ?? null,
        positionId: s.positionId ?? null, shiftTypeId: s.shiftTypeId ?? null,
      });
    }
  }
  return { payroll, rota };
}

async function mirrorShiftTypes(from: string, to: string): Promise<Map<number, number | null>> {
  try {
    const r = await db.execute<{ id: string; shift_type_id: string | null }>(sql`
      SELECT id, shift_type_id FROM planday_shifts_cache WHERE date BETWEEN ${from} AND ${to}
    `);
    return new Map(r.rows.map(x => [Number(x.id), x.shift_type_id != null ? Number(x.shift_type_id) : null]));
  } catch {
    return new Map(); // mirror not there yet — the rota's own types are used
  }
}

// ── Compute ───────────────────────────────────────────────────────────────

/**
 * Compute and store every production day in [from, to] (clamped to before
 * today). Returns how many days were written.
 */
export async function computeRange(from: string, to: string): Promise<number> {
  const today = londonDateString();
  const last = addDaysIso(today, -1);
  if (to > last) to = last;
  if (from > to) return 0;

  const settings = await loadSettings();
  const planDates = await planDatesAround(from, to);
  const targetDays = planDates.filter(d => d >= from && d <= to);
  if (targetDays.length === 0) return 0;

  const [positions, sections, shiftTypes, employer] = await Promise.all([
    getPlandayPositions(), getPlandaySections(), getPlandayShiftTypes(), getEmployerCostSettings(),
  ]);
  const section = sections.find(s => s.name.trim().toLowerCase() === settings.productionSection.toLowerCase());
  if (!section) throw new Error(`Planday section "${settings.productionSection}" not found`);

  // Whole weeks from a week before `from`: NI works on each person's week,
  // and weekend dough prep before the first day belongs to it.
  const fetchFrom = weekStart(addDaysIso(from, -7));
  const { payroll, rota } = await plandayWindow(fetchFrom, to);
  const onCost = { ...employer, holidayAccrual: settings.holidayAccrual };
  const multipliers = weeklyOnCostMultipliers(payroll, onCost);
  const labour = labourByProductionDay({
    payroll, rota,
    positions: positions.map(p => ({ id: p.id, name: p.name, sectionId: p.sectionId ?? null })),
    shiftTypes,
    shiftTypeByShiftId: await mirrorShiftTypes(fetchFrom, to),
    productionSectionId: section.id,
    sortedPlanDates: planDates,
    nonDispatchDays: await nonDispatchDays(),
    linePositions: settings.linePositions,
    multipliers,
    fallbackMultiplier: onCostMultiplier(0, onCost),
    today,
    staleAfterDays: STALE_AFTER_DAYS,
  });

  const [items, despatch] = await Promise.all([planItems(from, to), despatchInputs(from, to)]);

  let written = 0;
  for (const date of targetDays) {
    const l = labour.get(date);
    const dsp = despatch.get(date);
    const c: DayComponents = {
      date,
      made: madeByLine(items.get(date) ?? []),
      despatched: dsp?.lines ?? {},
      ordersDespatched: dsp?.orders ?? 0,
      labourCostTotal: l?.labourCostTotal ?? 0,
      lineLabour: l?.lineLabour ?? {},
      paidHours: l?.paidHours ?? 0,
      headcount: l?.headcount ?? 0,
      pendingShifts: l?.pendingShifts ?? 0,
      ignoredUnapproved: l?.ignoredUnapproved ?? 0,
    };
    await writeDay(c, settings);
    written++;
  }
  return written;
}

async function writeDay(c: DayComponents, s: TeSettings): Promise<void> {
  const d = deriveDay(c, s);
  await db.execute(sql`
    INSERT INTO team_efficiency_days (
      date, made, despatched, orders_despatched, labour_cost_total, line_labour, paid_hours, headcount,
      pending_shifts, ignored_unapproved, packs_by_line, eight_pack_bags, packs_despatched,
      value_made_net, value_despatched_net, value_credited, labour_cost, ratio, efficiency_pct, status, flags, computed_at
    ) VALUES (
      ${c.date}, ${JSON.stringify(c.made)}::jsonb, ${JSON.stringify(c.despatched)}::jsonb, ${c.ordersDespatched},
      ${c.labourCostTotal}, ${JSON.stringify(c.lineLabour)}::jsonb, ${c.paidHours}, ${c.headcount},
      ${c.pendingShifts}, ${c.ignoredUnapproved}, ${JSON.stringify(d.packsByLine)}::jsonb, ${d.eightPackBags}, ${d.packsDespatched},
      ${d.valueMadeNet}, ${d.valueDespatchedNet}, ${d.valueCredited}, ${d.labourCost}, ${d.ratio}, ${d.efficiencyPct},
      ${d.status}, ${JSON.stringify(d.flags)}::jsonb, NOW()
    )
    ON CONFLICT (date) DO UPDATE SET
      made = EXCLUDED.made, despatched = EXCLUDED.despatched, orders_despatched = EXCLUDED.orders_despatched,
      labour_cost_total = EXCLUDED.labour_cost_total, line_labour = EXCLUDED.line_labour,
      paid_hours = EXCLUDED.paid_hours, headcount = EXCLUDED.headcount,
      pending_shifts = EXCLUDED.pending_shifts, ignored_unapproved = EXCLUDED.ignored_unapproved,
      packs_by_line = EXCLUDED.packs_by_line, eight_pack_bags = EXCLUDED.eight_pack_bags,
      packs_despatched = EXCLUDED.packs_despatched, value_made_net = EXCLUDED.value_made_net,
      value_despatched_net = EXCLUDED.value_despatched_net, value_credited = EXCLUDED.value_credited,
      labour_cost = EXCLUDED.labour_cost, ratio = EXCLUDED.ratio, efficiency_pct = EXCLUDED.efficiency_pct,
      status = EXCLUDED.status, flags = EXCLUDED.flags, computed_at = NOW()
  `);
}

/** Re-derive every stored day under the current settings — no Planday. */
export async function restateAll(): Promise<number> {
  const settings = await loadSettings();
  const r = await db.execute<Record<string, unknown>>(sql`
    SELECT date::text AS date, made, despatched, orders_despatched, labour_cost_total, line_labour,
           paid_hours, headcount, pending_shifts, ignored_unapproved
    FROM team_efficiency_days
  `);
  const j = <T>(x: unknown): T => (typeof x === "string" ? JSON.parse(x) : x) as T;
  for (const x of r.rows) {
    await writeDay({
      date: String(x.date),
      made: j<Record<string, LineMade>>(x.made),
      despatched: j<Record<string, LineDespatched>>(x.despatched),
      ordersDespatched: num(x.orders_despatched),
      labourCostTotal: num(x.labour_cost_total),
      lineLabour: j<Record<string, number>>(x.line_labour),
      paidHours: num(x.paid_hours),
      headcount: num(x.headcount),
      pendingShifts: num(x.pending_shifts),
      ignoredUnapproved: num(x.ignored_unapproved),
    }, settings);
  }
  return r.rows.length;
}

// ── Backfill + nightly ────────────────────────────────────────────────────

/** Earliest day the backfill covers: 12 months back, or the first plan. */
async function historyStart(today: string): Promise<string | null> {
  const r = await db.execute<{ d: string | null }>(sql`SELECT min(plan_date)::text AS d FROM production_plans`);
  const first = r.rows[0]?.d ?? null;
  if (!first) return null;
  const yearAgo = addDaysIso(today, -HISTORY_DAYS);
  return first > yearAgo ? first : yearAgo;
}

/** Compute [from, to] oldest first in 28-day chunks (each chunk is one pass). */
export async function computeInChunks(from: string, to: string, label: string): Promise<number> {
  let total = 0;
  for (let start = from; start <= to; start = addDaysIso(start, CHUNK_DAYS)) {
    const end = addDaysIso(start, CHUNK_DAYS - 1) < to ? addDaysIso(start, CHUNK_DAYS - 1) : to;
    const n = await computeRange(start, end);
    total += n;
    console.log(`[team-efficiency] ${label}: ${start} → ${end} — ${n} production day(s)`);
  }
  return total;
}

let running: Promise<unknown> | null = null;

/** One job at a time: nightly, backfill and recompute never overlap. */
function exclusive<T>(work: () => Promise<T>): Promise<T> | null {
  if (running) return null;
  const p = work().finally(() => { running = null; });
  running = p;
  return p;
}

export function isJobRunning(): boolean {
  return running !== null;
}

async function backfillIfNeeded(): Promise<void> {
  const state = await readJobState("job_backfill") as { completedAt?: string } | null;
  if (state?.completedAt) return;
  const today = londonDateString();
  const from = await historyStart(today);
  if (!from) return;
  const to = addDaysIso(today, -1);
  console.log(`[team-efficiency] backfilling ${from} → ${to}`);
  const days = await computeInChunks(from, to, "backfill");
  await writeJobState("job_backfill", { completedAt: new Date().toISOString(), from, to, days });
  await writeJobState("job_nightly", { lastRun: today });
  console.log(`[team-efficiency] backfill complete — ${days} production day(s) since ${from}`);
}

async function nightlyIfDue(): Promise<void> {
  const today = londonDateString();
  if (londonHour() < NIGHTLY_HOUR) return;
  const state = await readJobState("job_nightly") as { lastRun?: string } | null;
  if (state?.lastRun === today) return;
  const n = await computeRange(addDaysIso(today, -RECENT_DAYS), addDaysIso(today, -1));
  await writeJobState("job_nightly", { lastRun: today });
  console.log(`[team-efficiency] nightly: ${n} recent production day(s) recomputed`);
}

/** Recompute all stored history from Planday (after a line-position or
 *  holiday-accrual change). Returns false when a job is already running. */
export function recomputeHistory(): boolean {
  const started = exclusive(async () => {
    const today = londonDateString();
    const from = await historyStart(today);
    if (!from) return;
    await computeInChunks(from, addDaysIso(today, -1), "recompute");
  });
  if (!started) return false;
  started.catch(err => console.warn("[team-efficiency] recompute failed:", err instanceof Error ? err.message : err));
  return true;
}

async function tick(): Promise<void> {
  if (!isPlandayConfigured()) return;
  if (!(await tableReady())) return; // first boot before migrations — next hour
  await backfillIfNeeded();
  await nightlyIfDue();
}

export function startTeamEfficiencyScheduler(): void {
  const run = () => {
    const p = exclusive(tick);
    p?.catch(err => console.warn("[team-efficiency] run failed (will retry next hour):", err instanceof Error ? err.message : err));
  };
  // Deferred well after listen and the attendance-mirror pre-warm, which
  // also reads Planday.
  setTimeout(run, 3 * 60_000).unref();
  setInterval(run, 60 * 60_000).unref();
}

/** Where the stored history starts and when it last ran — for the page. */
export async function jobMeta(): Promise<{ historyFrom: string | null; historyTo: string | null; lastComputedAt: string | null; backfillDone: boolean; running: boolean }> {
  const r = await db.execute<{ f: string | null; t: string | null; c: Date | null }>(sql`
    SELECT min(date)::text AS f, max(date)::text AS t, max(computed_at) AS c FROM team_efficiency_days
  `);
  const state = await readJobState("job_backfill") as { completedAt?: string } | null;
  const row = r.rows[0];
  return {
    historyFrom: row?.f ?? null,
    historyTo: row?.t ?? null,
    lastComputedAt: row?.c ? new Date(row.c).toISOString() : null,
    backfillDone: Boolean(state?.completedAt),
    running: isJobRunning(),
  };
}
