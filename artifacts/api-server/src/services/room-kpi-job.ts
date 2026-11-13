/**
 * Packing & wrapping room run rate — the job that fills room_kpi_days
 * (Graeme, 13 Nov 2026; rules in lib/room-kpi.ts).
 *
 *   - Nightly (first hourly tick after 02:00 London): the last 10 days, so
 *     shifts approved late still land. The room is the last team to finish,
 *     so a day's score appears the next morning.
 *   - Backfill: 8 weeks on first boot, then the 100% line is set from the
 *     median day (only if it isn't set yet — it then stays fixed).
 *   - Read only: Planday (Packer + Wrapper shifts), Shopify (orders
 *     fulfilled for the day's dispatch), the wrapping taps and goods-in.
 * Logs carry dates and counts, never pay.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getPlandayPayrollRows, getPlandayShifts, getPlandayPositions, getPlandayShiftTypes, isPlandayConfigured } from "./planday";
import { londonDateString, londonHour } from "../lib/london-time";
import { computePackingOrdersPerHourForDay } from "../lib/yesterday-kpis";
import { addDaysIso } from "../lib/team-efficiency-labour";
import { roomHoursByDay, calibrateStandardRatio, DEFAULT_ROOM_SETTINGS, type RoomDay, type RoomWeights } from "../lib/room-kpi";

const RECENT_DAYS = 10;
const BACKFILL_DAYS = 56;
const NIGHTLY_HOUR = 2;
const CHUNK_DAYS = 28; // Planday payroll windows stay ≤ 28 days

export const ROOM_SETTING_KEYS = {
  positions: "room_kpi_positions",
  deliveryMinutes: "room_kpi_delivery_minutes",
  lineMinutes: "room_kpi_line_minutes",
  standardRatio: "room_kpi_standard_ratio",
  standardSetOn: "room_kpi_standard_set_on",
  backfillDone: "room_kpi_backfill_done",
  lastNightly: "room_kpi_last_nightly",
} as const;

async function settings(): Promise<Map<string, string>> {
  const r = await db.execute<{ key: string; value: string | null }>(sql`
    SELECT key, value FROM app_settings WHERE key LIKE 'room_kpi_%' OR key LIKE 'production_kpi_%'
  `);
  return new Map(r.rows.filter(x => x.value != null).map(x => [x.key, x.value as string]));
}

export async function setRoomSetting(key: string, value: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);
}

export interface RoomConfig {
  positions: string[];
  weights: RoomWeights;
  standardRatio: number | null;
  standardSetOn: string | null;
}

/** Positions, credit weights (the packing + wrapping standards from
 *  production_kpis) and the 100% line. */
export async function loadRoomConfig(): Promise<RoomConfig> {
  const [s, kpis] = await Promise.all([
    settings(),
    db.execute<{ kpi: string; standard: string }>(sql`SELECT kpi, standard FROM production_kpis`).catch(() => ({ rows: [] as Array<{ kpi: string; standard: string }> })),
  ]);
  const std = new Map(kpis.rows.map(r => [r.kpi, Number(r.standard)]));
  let positions = DEFAULT_ROOM_SETTINGS.positions;
  try {
    const p = JSON.parse(s.get(ROOM_SETTING_KEYS.positions) ?? "null");
    if (Array.isArray(p) && p.every(x => typeof x === "string") && p.length) positions = p;
  } catch { /* default */ }
  const n = (k: string, fallback: number) => {
    const v = Number(s.get(k));
    return Number.isFinite(v) && v >= 0 && s.has(k) ? v : fallback;
  };
  const ratio = Number(s.get(ROOM_SETTING_KEYS.standardRatio));
  return {
    positions,
    weights: {
      packingPerHour: std.get("packing") || 55,
      wrappingPerHour: std.get("wrapping") || 115,
      deliveryMinutes: n(ROOM_SETTING_KEYS.deliveryMinutes, DEFAULT_ROOM_SETTINGS.deliveryMinutes),
      lineMinutes: n(ROOM_SETTING_KEYS.lineMinutes, DEFAULT_ROOM_SETTINGS.lineMinutes),
    },
    standardRatio: Number.isFinite(ratio) && ratio > 0 ? ratio : null,
    standardSetOn: s.get(ROOM_SETTING_KEYS.standardSetOn) ?? null,
  };
}

/** Raw counts that don't need Planday, per London day in [from, to]. */
async function workCounts(from: string, to: string): Promise<Map<string, { packs: number; deliveries: number; lines: number }>> {
  const [wraps, deliveries] = await Promise.all([
    db.execute<{ d: string; packs: string }>(sql`
      SELECT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')::date::text AS d, SUM(delta)::text AS packs
      FROM fridge_stock_changes
      WHERE source = 'wrapping' AND delta > 0
        AND created_at >= ${from}::date - INTERVAL '1 day' AND created_at < ${to}::date + INTERVAL '2 days'
      GROUP BY 1
    `),
    db.execute<{ d: string; deliveries: string; lines: string }>(sql`
      SELECT ((dr.received_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')::date::text AS d,
             COUNT(DISTINCT dr.id)::text AS deliveries,
             COUNT(pol.id) FILTER (WHERE pol.quantity_received > 0)::text AS lines
      FROM delivery_records dr
      LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = dr.purchase_order_id
      WHERE dr.received_at >= ${from}::date - INTERVAL '1 day' AND dr.received_at < ${to}::date + INTERVAL '2 days'
      GROUP BY 1
    `),
  ]);
  const out = new Map<string, { packs: number; deliveries: number; lines: number }>();
  const get = (d: string) => out.get(d) ?? out.set(d, { packs: 0, deliveries: 0, lines: 0 }).get(d)!;
  for (const r of wraps.rows) if (r.d >= from && r.d <= to) get(r.d).packs = Number(r.packs) || 0;
  for (const r of deliveries.rows) if (r.d >= from && r.d <= to) { const x = get(r.d); x.deliveries = Number(r.deliveries) || 0; x.lines = Number(r.lines) || 0; }
  return out;
}

/** Compute and store every day in [from, to] (never today) the room worked,
 *  in ≤ 28-day Planday windows (the payroll API's limit). */
export async function computeRoomRange(from: string, to: string): Promise<number> {
  const last = addDaysIso(londonDateString(), -1);
  if (to > last) to = last;
  let written = 0;
  for (let start = from; start <= to; start = addDaysIso(start, CHUNK_DAYS)) {
    const end = addDaysIso(start, CHUNK_DAYS - 1) < to ? addDaysIso(start, CHUNK_DAYS - 1) : to;
    written += await computeRoomWindow(start, end);
  }
  return written;
}

type CountedDay = RoomDay & { pending: boolean };

/** The room's raw counts and paid hours for each day in [from, to] it worked.
 *  Approved Planday shifts only unless `approvedOnly` is false — today's live
 *  estimate, priced from the rota (as Team efficiency's "today" does). A day
 *  whose Shopify fulfilments couldn't be read is left out, not stored low. */
async function roomDaysFor(from: string, to: string, opts: { approvedOnly?: boolean } = {}): Promise<CountedDay[]> {
  if (from > to) return [];
  const config = await loadRoomConfig();
  const [payroll, rota, positions, shiftTypes, counts] = await Promise.all([
    getPlandayPayrollRows(from, to, opts),
    getPlandayShifts(from, to),
    getPlandayPositions(),
    getPlandayShiftTypes(),
    workCounts(from, to),
  ]);
  if (!payroll) throw new Error(`Planday payroll unavailable for ${from} → ${to}`);
  const hours = roomHoursByDay({
    payroll: payroll.map(r => ({ ...r, breaks: r.breaks ?? [] })),
    rota: rota.map(s => ({ id: s.id, date: s.date, status: s.status ?? null, shiftTypeId: s.shiftTypeId ?? null, positionId: s.positionId ?? null })),
    positions, shiftTypes, positionNames: config.positions,
  });
  const days = [...new Set([...hours.keys(), ...counts.keys()])].filter(d => d >= from && d <= to).sort();
  const out: CountedDay[] = [];
  for (const d of days) {
    const h = hours.get(d);
    const c = counts.get(d) ?? { packs: 0, deliveries: 0, lines: 0 };
    // Boxes = orders fulfilled for the day's dispatch, exactly as the
    // packing KPI counts them (one Shopify read per day).
    let boxes = 0;
    try { boxes = (await computePackingOrdersPerHourForDay(d)).totalOrders; } catch (err) {
      console.warn(`[room-kpi] ${d}: couldn't read Shopify fulfilments:`, err instanceof Error ? err.message : err);
      continue; // try again next night rather than store a false low
    }
    if (!h && boxes === 0 && c.packs === 0) continue; // the room didn't work
    out.push({
      date: d, boxes, packs: c.packs, deliveries: c.deliveries, deliveryLines: c.lines,
      paidHours: h?.paidHours ?? 0, people: h?.people ?? 0, pending: Boolean(h?.pending),
    });
  }
  return out;
}

async function computeRoomWindow(from: string, to: string): Promise<number> {
  let written = 0;
  for (const d of await roomDaysFor(from, to)) {
    await db.execute(sql`
      INSERT INTO room_kpi_days (date, boxes, packs, deliveries, delivery_lines, paid_hours, people, status, computed_at)
      VALUES (${d.date}, ${d.boxes}, ${d.packs}, ${d.deliveries}, ${d.deliveryLines}, ${d.paidHours}, ${d.people}, ${d.pending ? "pending" : "ok"}, NOW())
      ON CONFLICT (date) DO UPDATE SET boxes = EXCLUDED.boxes, packs = EXCLUDED.packs, deliveries = EXCLUDED.deliveries,
        delivery_lines = EXCLUDED.delivery_lines, paid_hours = EXCLUDED.paid_hours, people = EXCLUDED.people,
        status = EXCLUDED.status, computed_at = NOW()
    `);
    written++;
  }
  console.log(`[room-kpi] stored ${written} day(s) ${from} → ${to}`);
  return written;
}

/** One day's room figures worked out now and NOT stored — today's live
 *  estimate for the end-of-day meeting (Graeme, 13 Nov 2026). Hours include
 *  shifts not yet approved, so they're the rota's until Planday approves.
 *  null when the room didn't work that day. */
export async function liveRoomDay(day: string): Promise<CountedDay | null> {
  return (await roomDaysFor(day, day, { approvedOnly: false }))[0] ?? null;
}

export async function loadRoomDays(from: string, to: string): Promise<Array<RoomDay & { status: string }>> {
  const r = await db.execute<Record<string, string>>(sql`
    SELECT date::text AS date, boxes, packs, deliveries, delivery_lines, paid_hours::text AS paid_hours, people, status
    FROM room_kpi_days WHERE date BETWEEN ${from} AND ${to} ORDER BY date
  `);
  return r.rows.map(x => ({
    date: x.date, boxes: Number(x.boxes), packs: Number(x.packs), deliveries: Number(x.deliveries),
    deliveryLines: Number(x.delivery_lines), paidHours: Number(x.paid_hours), people: Number(x.people), status: x.status,
  }));
}

/** Set the 100% line from the median of the last 4 weeks' complete days. */
export async function recalibrateRoomStandard(): Promise<number | null> {
  const today = londonDateString();
  const config = await loadRoomConfig();
  const days = (await loadRoomDays(addDaysIso(today, -28), addDaysIso(today, -1))).filter(d => d.status === "ok");
  const ratio = calibrateStandardRatio(days, config.weights);
  if (ratio == null) return null;
  await setRoomSetting(ROOM_SETTING_KEYS.standardRatio, String(ratio));
  await setRoomSetting(ROOM_SETTING_KEYS.standardSetOn, today);
  return ratio;
}

let running = false;
async function tick(): Promise<void> {
  if (!isPlandayConfigured()) return;
  const ready = await db.execute<{ ok: string | null }>(sql`SELECT to_regclass('public.room_kpi_days')::text AS ok`);
  if (!ready.rows[0]?.ok) return;
  const s = await settings();
  const today = londonDateString();
  if (!s.get(ROOM_SETTING_KEYS.backfillDone)) {
    await computeRoomRange(addDaysIso(today, -BACKFILL_DAYS), addDaysIso(today, -1));
    await setRoomSetting(ROOM_SETTING_KEYS.backfillDone, new Date().toISOString());
    await setRoomSetting(ROOM_SETTING_KEYS.lastNightly, today);
  } else if (londonHour() >= NIGHTLY_HOUR && s.get(ROOM_SETTING_KEYS.lastNightly) !== today) {
    await computeRoomRange(addDaysIso(today, -RECENT_DAYS), addDaysIso(today, -1));
    await setRoomSetting(ROOM_SETTING_KEYS.lastNightly, today);
  }
  // The 100% line is set once, from the first weeks of history, and then
  // kept fixed (the founder can reset it on the page).
  if (!(await loadRoomConfig()).standardRatio) await recalibrateRoomStandard();
}

export function startRoomKpiScheduler(): void {
  const run = () => {
    if (running) return;
    running = true;
    tick().catch(err => console.warn("[room-kpi] run failed (will retry next hour):", err instanceof Error ? err.message : err))
      .finally(() => { running = false; });
  };
  // After the team-efficiency job's first Planday read.
  setTimeout(run, 6 * 60_000).unref();
  setInterval(run, 60 * 60_000).unref();
}
