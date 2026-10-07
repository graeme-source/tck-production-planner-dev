/**
 * Which stations today's Planday rota puts a person on — the I/O half of
 * the rota → station rule (the pure half is rosteredStations in
 * lib/station-sop-training.ts).
 *
 * Moved out of routes/station-training.ts (2026-10-07) so the station SOP
 * gate and team messages ask the SAME question the same way, instead of a
 * second copy of the Planday lookup drifting from the first.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { londonDateString } from "./london-time";
import { rosteredStations, type RotaMapping } from "./station-sop-training";

// Today's rota changes rarely and Planday costs round trips, so keep it a
// few minutes. Keyed by London date so it can never serve yesterday's rota.
let rotaCache: { date: string; at: number; byEmployee: Map<number, string[]> } | null = null;
const ROTA_TTL_MS = 5 * 60 * 1000;

/** Today's Planday position names per Planday employee id (cached). */
export async function todaysPositionsByEmployee(): Promise<Map<number, string[]>> {
  const today = londonDateString();
  if (rotaCache && rotaCache.date === today && Date.now() - rotaCache.at < ROTA_TTL_MS) return rotaCache.byEmployee;
  const { isPlandayConfigured, getPlandayShifts, getPlandayPositions } = await import("../services/planday");
  const byEmployee = new Map<number, string[]>();
  if (isPlandayConfigured()) {
    const [shifts, positions] = await Promise.all([getPlandayShifts(today, today), getPlandayPositions()]);
    const posName = new Map(positions.map(p => [p.id, p.name]));
    for (const s of shifts) {
      if (s.employeeId == null || s.positionId == null) continue;
      const name = posName.get(s.positionId);
      if (!name) continue;
      const list = byEmployee.get(s.employeeId) ?? [];
      list.push(name);
      byEmployee.set(s.employeeId, list);
    }
  }
  rotaCache = { date: today, at: Date.now(), byEmployee };
  return byEmployee;
}

/** The morning meeting's Planday position → station title mapping. */
export async function rotaMapping(): Promise<RotaMapping> {
  const r = await db.execute<{ value: string }>(sql`SELECT value FROM app_settings WHERE key = 'station_assignments_mapping'`);
  try { return JSON.parse((r.rows ?? [])[0]?.value ?? "") as RotaMapping; } catch { return { stations: [] }; }
}

/** The station keys today's rota puts this app user on. Empty when they
 *  aren't linked to Planday, aren't on today, or Planday can't be reached —
 *  callers decide whether that fails open or closed. Throws nothing. */
export async function rosteredStationsForUser(userId: number): Promise<Set<string>> {
  try {
    const u = await db.execute<{ planday_employee_id: number | null }>(sql`SELECT planday_employee_id FROM app_users WHERE id = ${userId}`);
    const empId = (u.rows ?? [])[0]?.planday_employee_id;
    if (empId == null) return new Set();
    const [positions, mapping] = await Promise.all([todaysPositionsByEmployee(), rotaMapping()]);
    return rosteredStations(positions.get(Number(empId)) ?? [], mapping);
  } catch (err) {
    console.error("[station-rota] rota lookup failed:", err);
    return new Set();
  }
}
