/**
 * Team efficiency for the meetings (Graeme, 20 Nov 2026): one % per day.
 * The stored figure once the day's shifts are approved; until then the
 * estimate (punch clock or rota hours; today only up to now). Percent only —
 * the meetings never show pounds or hours.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { estimateForDay } from "./team-efficiency-today";

export interface MeetingEfficiency { pct: number | null; estimate: boolean }

/** Approved days' stored % for [from, to]. */
export async function storedEfficiency(from: string, to: string): Promise<Map<string, number | null>> {
  const ready = await db.execute<{ ok: string | null }>(sql`SELECT to_regclass('public.team_efficiency_days')::text AS ok`);
  if (!ready.rows[0]?.ok) return new Map();
  const r = await db.execute<{ date: string; efficiency_pct: string | null }>(sql`
    SELECT date::text AS date, efficiency_pct::text AS efficiency_pct
    FROM team_efficiency_days WHERE date BETWEEN ${from} AND ${to} AND status = 'ok'
  `);
  return new Map(r.rows.map(x => [x.date, x.efficiency_pct == null ? null : Math.round(Number(x.efficiency_pct))]));
}

/** One day: stored if approved, else the estimate. null when neither can be had. */
export async function efficiencyForDay(day: string, stored?: Map<string, number | null>): Promise<MeetingEfficiency | null> {
  const s = stored ?? await storedEfficiency(day, day);
  if (s.has(day)) return { pct: s.get(day) ?? null, estimate: false };
  const r = await estimateForDay(day);
  if ("unavailable" in r) return null;
  return { pct: r.estimate.status === "estimate" && r.estimate.estimatePct != null ? Math.round(r.estimate.estimatePct) : null, estimate: true };
}
