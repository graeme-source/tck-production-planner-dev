/**
 * Improvement time on the KPIs (Graeme, 27 Nov 2026) — reads what the pure
 * rules in lib/improvement-kpi-credit.ts need, for a range of London days:
 *
 *   - the minutes per improvement (app_settings improvement_kpi_minutes,
 *     default 10; Analytics → KPIs, managers and admins)
 *   - improvements done in the range and everyone credited on each
 *     (lead + improvement_credits, lib/improvement-credits-data.ts)
 *   - who is which Planday employee (app_users.planday_employee_id)
 *   - their rota shifts from the Planday attendance mirror, with each
 *     position's name and section, and the shift type
 *   - the room's positions (room_kpi_positions) and the Production section
 *     name (team efficiency's setting)
 *
 * Never throws: if anything can't be read, the KPIs come back exactly as
 * they were without the credit, and the breakdown says why. Read only.
 * Cached for a minute per range (Analytics loads several KPIs at once).
 * Objective E.
 */
import { db, appSettingsTable, improvementSubmissionsTable } from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import {
  improvementCreditByDay, parseImprovementMinutes, IMPROVEMENT_KPI_MINUTES_SETTING,
  type CreditShift, type CreditedImprovement, type DayCredit,
} from "../lib/improvement-kpi-credit";
import { IMPROVEMENT_DONE_STATUSES } from "../lib/improvements-completed";
import { creditsFor } from "../lib/improvement-credits-data";
import { intArrayLiteral } from "../lib/int-array-literal";
import { londonDayStartUtc } from "../lib/london-time";
import { addDaysIso } from "../lib/team-efficiency-labour";
import { getPlandayPositions, getPlandaySections, getPlandayShiftTypes, isPlandayConfigured } from "./planday";
import { getAttendanceFromCache } from "./planday-attendance-cache";
import { loadSettings as loadTeamEfficiencySettings } from "./team-efficiency-job";
// room-kpi-job is imported where it's used: it reads lib/yesterday-kpis,
// which reads this file — a static import would be a cycle.

export interface ImprovementKpiCredit {
  minutesPerImprovement: number;
  days: Map<string, DayCredit>;
  /** Room positions used for the split (for the screen's wording). */
  roomPositions: string[];
  /** Why shifts couldn't be used, when they couldn't. */
  unavailable: string | null;
}

export async function loadImprovementMinutes(): Promise<number> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable)
    .where(eq(appSettingsTable.key, IMPROVEMENT_KPI_MINUTES_SETTING));
  return parseImprovementMinutes(row?.value ?? null);
}

export async function saveImprovementMinutes(minutes: number): Promise<void> {
  await db.insert(appSettingsTable).values({ key: IMPROVEMENT_KPI_MINUTES_SETTING, value: String(minutes) })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: String(minutes) } });
  cache.clear();
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<ImprovementKpiCredit> }>();

export function loadImprovementKpiCredit(from: string, to: string): Promise<ImprovementKpiCredit> {
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = compute(from, to);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

const EMPTY = (minutes: number, unavailable: string | null): ImprovementKpiCredit =>
  ({ minutesPerImprovement: minutes, days: new Map(), roomPositions: [], unavailable });

async function compute(from: string, to: string): Promise<ImprovementKpiCredit> {
  if (from > to) return EMPTY(10, null);
  let minutes = 10;
  try {
    minutes = await loadImprovementMinutes();
    if (minutes <= 0) return EMPTY(minutes, null);

    // Improvements done in the range (London days, exact whatever the
    // server's timezone), with everyone credited on each.
    const subs = await db.select({
      id: improvementSubmissionsTable.id,
      progressStatus: improvementSubmissionsTable.progressStatus,
      doneAt: improvementSubmissionsTable.doneAt,
      creditedTo: improvementSubmissionsTable.creditedTo,
      creditedToName: improvementSubmissionsTable.creditedToName,
    }).from(improvementSubmissionsTable).where(and(
      inArray(improvementSubmissionsTable.progressStatus, [...IMPROVEMENT_DONE_STATUSES]),
      isNotNull(improvementSubmissionsTable.doneAt),
      gte(improvementSubmissionsTable.doneAt, londonDayStartUtc(from)),
      lte(improvementSubmissionsTable.doneAt, londonDayStartUtc(addDaysIso(to, 1))),
    ));
    if (subs.length === 0) return EMPTY(minutes, null);
    const credits = await creditsFor(subs);
    const rows: CreditedImprovement[] = [];
    for (const s of subs) {
      for (const p of credits.get(s.id) ?? []) {
        rows.push({ improvementId: s.id, progressStatus: s.progressStatus, doneAt: s.doneAt, userId: p.userId, name: p.name });
      }
    }
    const userIds = [...new Set(rows.map(r => r.userId))];
    const users = userIds.length ? (await db.execute<{ id: number; planday_employee_id: number | null }>(sql`
      SELECT id, planday_employee_id FROM app_users WHERE id = ANY(${intArrayLiteral(userIds)}::int[])
    `)).rows ?? [] : [];
    const plandayIdByUser = new Map(users.map(u => [Number(u.id), u.planday_employee_id != null ? Number(u.planday_employee_id) : null]));

    const room = await (await import("./room-kpi-job")).loadRoomConfig();
    let shifts: CreditShift[] = [];
    let productionSectionId: number | null = null;
    let unavailable: string | null = null;
    if (!isPlandayConfigured()) {
      unavailable = "Planday isn't connected";
    } else {
      try {
        const [attendance, positions, sections, types, te] = await Promise.all([
          getAttendanceFromCache(from, to),
          getPlandayPositions(),
          getPlandaySections(),
          getPlandayShiftTypes(),
          loadTeamEfficiencySettings(),
        ]);
        const sectionName = te.productionSection.trim().toLowerCase();
        productionSectionId = sections.find(s => s.name.trim().toLowerCase() === sectionName)?.id ?? null;
        const pos = new Map(positions.map(p => [p.id, p]));
        const typeName = new Map(types.map(t => [t.id, t.name]));
        shifts = attendance.shifts.map(s => {
          const p = s.positionId != null ? pos.get(s.positionId) : undefined;
          return {
            employeeId: s.employeeId,
            date: s.date,
            positionName: p?.name ?? null,
            positionSectionId: p?.sectionId ?? null,
            shiftTypeName: s.shiftTypeId != null ? typeName.get(s.shiftTypeId) ?? null : null,
          };
        });
      } catch (err) {
        console.warn("[improvement-kpi-credit] Planday shifts unavailable:", err instanceof Error ? err.message : err);
        unavailable = "Couldn't read the Planday rota";
      }
    }

    const days = improvementCreditByDay({
      rows, plandayIdByUser, shifts,
      roomPositions: room.positions,
      productionSectionId,
      minutesPerImprovement: minutes,
      shiftsKnown: unavailable == null,
      from, to,
    });
    return { minutesPerImprovement: minutes, days, roomPositions: room.positions, unavailable };
  } catch (err) {
    console.warn("[improvement-kpi-credit] failed, KPIs shown without it:", err instanceof Error ? err.message : err);
    return EMPTY(minutes, "Couldn't work out the improvement credit");
  }
}
