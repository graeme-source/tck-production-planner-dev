/**
 * Approved Planday shifts as HOURS ONLY, for the "Hours worked" report on a
 * person's record and the team's "Hours vs contract" view (Objective I).
 *
 * Payroll is fetched for the whole department in 28-day blocks on a fixed
 * grid (lib/hours-worked.ts payrollBlocks), so the team view makes one call
 * per block for everyone — never one per person — and every range shares
 * the same cached blocks. Each row is stripped to hours the moment it
 * arrives (toHoursShift): pay is never cached, returned or logged.
 *
 * Cache: 10 minutes for blocks touching the last five weeks (approvals and
 * punch corrections still land there), 6 hours for older blocks. A failed
 * call is never cached; the caller answers "unreachable".
 */
import { getPlandayPayrollRows, isPlandayConfigured } from "./planday";
import { payrollBlocks, toHoursShift, type HoursShift } from "../lib/hours-worked";
import { addDaysIso } from "../lib/team-efficiency-labour";
import { londonDateString } from "../lib/london-time";

const RECENT_TTL_MS = 10 * 60 * 1000;
const OLD_TTL_MS = 6 * 60 * 60 * 1000;
const RECENT_DAYS = 35;

const blockCache = new Map<string, { rows: HoursShift[]; expiresAt: number }>();
const inFlight = new Map<string, Promise<HoursShift[] | null>>();

async function fetchBlock(block: { from: string; to: string }): Promise<HoursShift[] | null> {
  const key = `${block.from}|${block.to}`;
  const hit = blockCache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.rows;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const work = (async () => {
    const raw = await getPlandayPayrollRows(block.from, block.to);
    if (!raw) return null;
    const rows = raw.map(r => toHoursShift({
      id: r.id, employeeId: r.employeeId, date: r.date, start: r.start, end: r.end, breaks: r.breaks,
    }));
    const recent = block.to >= addDaysIso(londonDateString(), -RECENT_DAYS);
    blockCache.set(key, { rows, expiresAt: Date.now() + (recent ? RECENT_TTL_MS : OLD_TTL_MS) });
    return rows;
  })();
  inFlight.set(key, work);
  try {
    return await work;
  } finally {
    inFlight.delete(key);
  }
}

export type PayrollHoursResult =
  | { status: "ok"; shifts: HoursShift[] }
  | { status: "not_configured" | "unreachable" };

/** Every approved shift in [from, to] for the whole department, hours only. */
export async function getPayrollHours(from: string, to: string): Promise<PayrollHoursResult> {
  if (!isPlandayConfigured()) return { status: "not_configured" };
  try {
    // A block at a time: Planday allows ~20 requests a second and a year is
    // only 14 blocks, so there's no need to fire them all at once.
    const shifts: HoursShift[] = [];
    const seen = new Set<number>();
    for (const block of payrollBlocks(from, to)) {
      const rows = await fetchBlock(block);
      if (!rows) return { status: "unreachable" };
      for (const r of rows) {
        if (r.date < from || r.date > to || seen.has(r.id)) continue;
        seen.add(r.id);
        shifts.push(r);
      }
    }
    return { status: "ok", shifts };
  } catch (err) {
    console.warn("[planday-hours] payroll read failed:", err instanceof Error ? err.message : err);
    return { status: "unreachable" };
  }
}
