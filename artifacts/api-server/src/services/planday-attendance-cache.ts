/**
 * Planday attendance mirror (Graeme, 2026-09-14).
 *
 * The Employee Records report used to call Planday live for its whole date
 * range on every load — months of shifts at 50 a page, sequentially, behind
 * a ~20 req/s rate limit — which took minutes. Attendance history barely
 * changes, so shifts and absence records are mirrored into Postgres and the
 * report reads the mirror instantly. On each read we only hit Planday for:
 *   - dates the mirror has never covered (one-off backfill, then never again);
 *   - the trailing FRESH_WINDOW_DAYS, at most once per FRESH_TTL_MS, because
 *     managers do edit recent days (marking lates, approving sickness).
 * A ?refresh=1 request forces the trailing re-sync for out-of-band
 * corrections. If Planday is down we serve the mirror as-is and say when it
 * was last synced rather than failing the report.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  getPlandayShifts,
  getPlandayAbsenceRecords,
  isPlandayConfigured,
  type PlandayShift,
  type PlandayAbsenceRecord,
} from "./planday";

import { addDays, missingRanges, extendCoverage, type DateRange } from "./planday-attendance-ranges";

const FRESH_WINDOW_DAYS = 21;
const FRESH_TTL_MS = 60 * 60 * 1000; // re-pull the trailing window at most hourly

// ── Sync ───────────────────────────────────────────────────────────────────

/** Window-replace one date range of the mirror from Planday. Throws on API
 *  failure so callers can decide whether coverage may be extended. */
async function syncRange(range: DateRange): Promise<void> {
  const [shifts, absences] = await Promise.all([
    getPlandayShifts(range.from, range.to),
    getPlandayAbsenceRecords(range.from, range.to),
  ]);

  await db.execute(sql`DELETE FROM planday_shifts_cache WHERE date >= ${range.from} AND date <= ${range.to}`);
  for (const s of shifts) {
    const date = (s.date ?? "").slice(0, 10);
    if (!date) continue;
    await db.execute(sql`
      INSERT INTO planday_shifts_cache (id, employee_id, shift_type_id, position_id, date, updated_at)
      VALUES (${s.id}, ${s.employeeId ?? null}, ${s.shiftTypeId ?? null}, ${s.positionId ?? null}, ${date}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        employee_id = EXCLUDED.employee_id,
        shift_type_id = EXCLUDED.shift_type_id,
        position_id = EXCLUDED.position_id,
        date = EXCLUDED.date,
        updated_at = NOW()
    `);
  }

  // Absence records span ranges; Planday returns every record overlapping
  // the window, so replace exactly the overlapping set.
  await db.execute(sql`DELETE FROM planday_absences_cache WHERE start_date <= ${range.to} AND end_date >= ${range.from}`);
  for (const r of absences) {
    const regDates = (r.registrations ?? []).map(reg => (reg.date ?? "").slice(0, 10)).filter(Boolean).sort();
    const start = (r.absencePeriod?.start ?? "").slice(0, 10) || regDates[0] || "";
    const end = (r.absencePeriod?.end ?? "").slice(0, 10) || regDates[regDates.length - 1] || "";
    if (!start || !end) continue; // nothing dateable — contributes nothing to any report
    await db.execute(sql`
      INSERT INTO planday_absences_cache (id, employee_id, status, start_date, end_date, record, updated_at)
      VALUES (${r.id}, ${r.employeeId ?? null}, ${r.status ?? null}, ${start}, ${end}, ${JSON.stringify(r)}::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET
        employee_id = EXCLUDED.employee_id,
        status = EXCLUDED.status,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        record = EXCLUDED.record,
        updated_at = NOW()
    `);
  }
}

interface SyncState { from: string | null; to: string | null; freshAt: Date | null }

async function readState(): Promise<SyncState> {
  const rows = await db.execute<{ synced_from: string | null; synced_to: string | null; fresh_synced_at: Date | null }>(
    sql`SELECT synced_from::text, synced_to::text, fresh_synced_at FROM planday_attendance_sync WHERE id = 1`,
  );
  const row = rows.rows[0];
  return { from: row?.synced_from ?? null, to: row?.synced_to ?? null, freshAt: row?.fresh_synced_at ?? null };
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface AttendanceCacheResult {
  shifts: PlandayShift[];
  absences: PlandayAbsenceRecord[];
  /** When the trailing window last synced — "data as of" for the UI. */
  syncedAt: string | null;
  /** True when a Planday sync failed and the mirror may be behind. */
  stale: boolean;
}

/**
 * Serve attendance data for [from, to] out of the mirror, syncing only what
 * is missing or recently editable. Concurrent calls queue behind one sync so
 * two open report tabs can't double-fetch from Planday.
 */
let syncChain: Promise<void> = Promise.resolve();

export async function getAttendanceFromCache(
  from: string,
  to: string,
  opts?: { forceFresh?: boolean },
): Promise<AttendanceCacheResult> {
  let stale = false;

  if (isPlandayConfigured()) {
    const work = async () => {
      const state = await readState();
      const today = new Date().toISOString().slice(0, 10);

      // 1. Backfill anything never covered.
      const gaps = missingRanges({ from, to }, { from: state.from, to: state.to });
      let covered = { from: state.from, to: state.to };
      for (const gap of gaps) {
        console.log(`[planday-cache] backfilling ${gap.from} → ${gap.to}`);
        await syncRange(gap);
        covered = extendCoverage(covered, gap);
        await db.execute(sql`UPDATE planday_attendance_sync SET synced_from = ${covered.from}, synced_to = ${covered.to} WHERE id = 1`);
      }

      // 2. Re-pull the trailing window when it's gone stale — recent days
      // are the only ones managers edit.
      const freshDue = !state.freshAt || Date.now() - new Date(state.freshAt).getTime() > FRESH_TTL_MS;
      if (freshDue || opts?.forceFresh) {
        const winFrom = addDays(today, -FRESH_WINDOW_DAYS);
        const winTo = covered.to && covered.to < today ? covered.to : today;
        if (covered.from && winFrom <= winTo) {
          const clampedFrom = winFrom < covered.from ? covered.from : winFrom;
          await syncRange({ from: clampedFrom, to: winTo });
        }
        await db.execute(sql`UPDATE planday_attendance_sync SET fresh_synced_at = NOW() WHERE id = 1`);
      }
    };

    // Chain so overlapping requests don't sync the same ranges twice.
    const run = syncChain.then(work);
    syncChain = run.catch(() => {});
    try {
      await run;
    } catch (err) {
      console.warn("[planday-cache] sync failed, serving mirror as-is:", err);
      stale = true;
    }
  } else {
    stale = true;
  }

  const [shiftRows, absenceRows, state] = await Promise.all([
    db.execute<{ id: string; employee_id: string | null; shift_type_id: string | null; position_id: string | null; date: string }>(
      sql`SELECT id, employee_id, shift_type_id, position_id, date::text FROM planday_shifts_cache WHERE date >= ${from} AND date <= ${to}`,
    ),
    db.execute<{ record: unknown }>(
      sql`SELECT record FROM planday_absences_cache WHERE start_date <= ${to} AND end_date >= ${from}`,
    ),
    readState(),
  ]);

  const shifts: PlandayShift[] = shiftRows.rows.map(r => ({
    id: Number(r.id),
    employeeId: r.employee_id != null ? Number(r.employee_id) : null,
    shiftTypeId: r.shift_type_id != null ? Number(r.shift_type_id) : null,
    positionId: r.position_id != null ? Number(r.position_id) : null,
    date: r.date,
  }));

  const absences = absenceRows.rows
    .map(r => (typeof r.record === "string" ? JSON.parse(r.record) : r.record) as PlandayAbsenceRecord)
    .filter(Boolean);

  return { shifts, absences, syncedAt: state.freshAt ? new Date(state.freshAt).toISOString() : null, stale };
}

/**
 * Boot-time pre-warm: if the mirror is empty, backfill the last year in the
 * background so even the first report load after deploy is instant. Guarded
 * on table existence because startup one-shots can run before SQL migrations
 * on a first boot — the post-deploy restart completes it.
 */
export function prewarmAttendanceCache(): void {
  if (!isPlandayConfigured()) return;
  setTimeout(async () => {
    try {
      const exists = await db.execute<{ ok: string | null }>(
        sql`SELECT to_regclass('public.planday_attendance_sync')::text AS ok`,
      );
      if (!exists.rows[0]?.ok) {
        console.log("[planday-cache] tables not ready yet — pre-warm deferred to next boot");
        return;
      }
      const state = await readState();
      if (state.from) return; // already has coverage
      const today = new Date().toISOString().slice(0, 10);
      const from = addDays(today, -365);
      console.log(`[planday-cache] pre-warming mirror ${from} → ${today}`);
      await getAttendanceFromCache(from, today);
      console.log("[planday-cache] pre-warm complete");
    } catch (err) {
      console.warn("[planday-cache] pre-warm failed (report loads will backfill instead):", err);
    }
  }, 15_000);
}
