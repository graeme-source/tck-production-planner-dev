/**
 * The packing & wrapping room's score for one day, worked out now, with the
 * two speeds it's made of — boxes packed per hour and packs wrapped per hour
 * (Graeme, 20 Nov 2026: "it should show everywhere that we show the boxes
 * per hour KPI … boxes per hour and packs wrapped per hour underneath in
 * small writing"). Today counts each shift only up to now; an earlier day
 * uses its stored figure when there is one.
 *
 * Cached for three minutes per day: the packing screen, packing station,
 * dashboard and KPIs page all poll it, and each read touches Planday and
 * Shopify.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { liveRoomDay, loadRoomConfig, loadRoomDays } from "./room-kpi-job";
import { earnedHours, roomBand, roomRatio, roomScore, type RoomDay } from "../lib/room-kpi";
import { computePackingOrdersPerHourForDay } from "../lib/yesterday-kpis";
import { getStandardBreakConfig } from "../lib/batches-per-hour";
import { paceFromSubs } from "./wrapping-pace";
import { londonDateString } from "../lib/london-time";

export interface RoomLive {
  date: string;
  score: number | null;
  band: ReturnType<typeof roomBand>;
  /** Some room shift isn't approved in Planday yet: hours are from the punch clock or the rota. */
  estimate: boolean;
  /** Today, worked out up to now. */
  live: boolean;
  boxes: number;
  packs: number;
  paidHours: number;
  earnedHours: number;
  people: number;
  boxesPerHour: number | null;
  packsPerHour: number | null;
}

const TTL_MS = 3 * 60_000;
const cache = new Map<string, { at: number; value: RoomLive | null }>();

/** Packs wrapped per hour on one London day — the wrapping station's pace,
 *  same maths as GET /reports/wrapping-speed. */
export async function wrappingPacksPerHourForDay(day: string): Promise<number | null> {
  const rows = await db.execute<{ created_at: string; delta: number }>(sql`
    SELECT created_at, delta FROM fridge_stock_changes
    WHERE source = 'wrapping' AND delta > 0
      AND created_at >= ${day}::date AND created_at < (${day}::date + INTERVAL '1 day')
    ORDER BY created_at
  `);
  const subs = (rows.rows ?? []).map(r => ({ ts: new Date(r.created_at + "Z").getTime(), packs: Number(r.delta) }));
  return paceFromSubs(subs, await getStandardBreakConfig()).packsPerHour;
}

/** Drop a day's cached figure — after the shift is closed down or reopened,
 *  so the screens show the new hours straight away. */
export function forgetRoomDay(day: string): void {
  cache.delete(day);
}

export async function roomForDay(day: string): Promise<RoomLive | null> {
  const hit = cache.get(day);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const live = day === londonDateString();
  const [config, stored] = await Promise.all([loadRoomConfig(), live ? Promise.resolve([]) : loadRoomDays(day, day)]);
  const d: (RoomDay & { pending?: boolean; status?: string }) | null = stored[0] ?? await liveRoomDay(day);
  let value: RoomLive | null = null;
  if (d) {
    const [packing, wrapping] = await Promise.all([
      computePackingOrdersPerHourForDay(day).then(p => p.ordersPerHour).catch(() => null),
      wrappingPacksPerHourForDay(day).catch(() => null),
    ]);
    const score = roomScore(roomRatio(d, config.weights), config.standardRatio);
    value = {
      date: day, score, band: roomBand(score),
      estimate: d.status ? d.status === "pending" : Boolean(d.pending),
      live,
      boxes: d.boxes, packs: d.packs, paidHours: d.paidHours, people: d.people,
      earnedHours: Math.round(earnedHours(d, config.weights).earnedHours * 100) / 100,
      boxesPerHour: packing, packsPerHour: wrapping,
    };
  }
  cache.set(day, { at: Date.now(), value });
  return value;
}
