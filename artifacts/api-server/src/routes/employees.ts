/**
 * Employee records / attendance report.
 * Admin-only. Pulls data from Plan Day, auto-matches Plan Day employees to app
 * users by email, and summarises per user for a date range:
 *   - total shifts          (from Scheduling API, one count per scheduled shift)
 *   - arrived late          (shift types whose name contains "late" —
 *                             surfaced separately on the summary cards)
 *   - total absent          (sum of all approved absence days regardless of
 *                             account — e.g. sick, dependency leave,
 *                             emergency leave)
 *   - shiftTypeCounts       (one entry per Plan Day shift type name the
 *                             employee had in range)
 *   - absenceAccountCounts  (one entry per Plan Day absence account name
 *                             with approved days in range)
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import {
  getPlandayEmployees,
  getPlandayShiftTypes,
  getPlandayAbsenceAccounts,
  isPlandayConfigured,
} from "../services/planday";
import { getAttendanceFromCache } from "../services/planday-attendance-cache";
import { isLateName, isAbsenceReasonName, isSickName, countSickInstances } from "../services/attendance-classify";

const router: IRouter = Router();

// ── Auth: manager+ ─────────────────────────────────────────────────────────

async function requireManager(req: Request, res: Response, next: NextFunction) {
  const allowed = (role: string | undefined) => role === "admin" || role === "manager";
  if (allowed(req.session.userRole)) { next(); return; }
  if (req.session.userId && !req.session.userRole) {
    const [user] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, req.session.userId));
    if (user) {
      req.session.userRole = user.role as "admin" | "manager" | "viewer";
      if (allowed(user.role)) { next(); return; }
    }
  }
  res.status(403).json({ error: "Manager access required" });
}

router.use(requireManager);

// ── Classification helpers ─────────────────────────────────────────────────
// isAbsenceReasonName / isLateName live in services/attendance-classify.ts:
// "absent" means a REASON someone wasn't at work (sickness paid or unpaid,
// Absent, dependants/emergency leave) — holiday and holiday accrual accounts
// never count, and Meeting/Training/Holiday columns aren't shown at all
// (Graeme, 2026-09-14).

function daysBetweenInclusive(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 1;
  return Math.max(1, Math.floor((e - s) / 86_400_000) + 1);
}

function clampToRange(absStart: string, absEnd: string, from: string, to: string): number {
  const s = absStart < from ? from : absStart;
  const e = absEnd > to ? to : absEnd;
  if (s > e) return 0;
  return daysBetweenInclusive(s, e);
}

// ── Types ──────────────────────────────────────────────────────────────────

interface EmployeeAttendanceRow {
  userId: number;
  userName: string;
  userEmail: string;
  role: string;
  plandayEmployeeId: number | null;
  linked: boolean;
  totalShifts: number;
  lateShifts: number;
  totalAbsent: number;
  // All sickness types consolidated: days, and INSTANCES (one continuous
  // run of sick days = one instance).
  sickDays: number;
  sickInstances: number;
  shiftTypeCounts: Record<string, number>;
  absenceAccountCounts: Record<string, number>;
}

interface AttendanceResponse {
  available: boolean;
  from: string;
  to: string;
  rows: EmployeeAttendanceRow[];
  unmatchedAppUsers: Array<{ userId: number; name: string; email: string }>;
  // Planday employees that don't have an app user — these are candidates
  // for invite, e.g. new hires who appear in the Plan Day roster before
  // anyone's created them a login in the planner. `dismissed` marks ones a
  // manager has waved away (the accountant is on the rota system but will
  // never need a planner login) — hidden by default, restorable.
  unmatchedPlandayEmployees: Array<{ plandayEmployeeId: number; name: string; email: string | null; dismissed: boolean }>;
  shiftTypeNames: string[];
  absenceAccountNames: string[];
  // Column drivers for the frontend table. Every configured Plan Day shift
  // type gets a column so zero-activity types (e.g. Sick Leave in a good
  // week) still appear — managers rely on the column being there to know
  // they've looked at it. Absence accounts are only shown when there's
  // activity because they're typically a bigger and sparser list.
  activeShiftTypeNames: string[];
  activeAbsenceAccountNames: string[];
  // Which shift types count toward the Total Absent rollup. True for unpaid
  // absence types (Absent, Sick Leave, etc.), false for paid / non-absence
  // types (Holiday with Pay, Arrived late, Meeting, Training…).
  shiftTypeIsUnpaid: Record<string, boolean>;
  // Mirror freshness: when the trailing window last synced from Plan Day,
  // and whether the last sync attempt failed (mirror may be behind).
  syncedAt: string | null;
  stale: boolean;
}

// ── Dismissed "no planner login" rows ──────────────────────────────────────
// A JSON id list in app_settings: some Planday people (the accountant, a
// contractor) will never need a planner login, and their invite card was
// permanently in the way of the attendance report (Graeme, 2026-09-14).
const DISMISSED_KEY = "attendance_dismissed_planday_ids";

async function readDismissedPlandayIds(): Promise<Set<number>> {
  try {
    const rows = await db.execute<{ value: string }>(
      sql`SELECT value FROM app_settings WHERE key = ${DISMISSED_KEY}`,
    );
    const parsed = JSON.parse(rows.rows[0]?.value ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : []);
  } catch {
    return new Set();
  }
}

const dismissSchema = z.object({
  plandayEmployeeId: z.number().int(),
  dismissed: z.boolean(),
});

// POST /attendance/unmatched-dismiss — hide (or restore) one Planday
// employee's "invite to planner" card, for everyone, persistently.
router.post("/attendance/unmatched-dismiss", validate(dismissSchema), async (req: Request, res: Response) => {
  const { plandayEmployeeId, dismissed } = req.body as { plandayEmployeeId: number; dismissed: boolean };
  const ids = await readDismissedPlandayIds();
  if (dismissed) ids.add(plandayEmployeeId); else ids.delete(plandayEmployeeId);
  const value = JSON.stringify([...ids]);
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES (${DISMISSED_KEY}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
  res.json({ dismissedIds: [...ids] });
});

// ── Main route ─────────────────────────────────────────────────────────────

router.get("/attendance", async (req: Request, res: Response) => {
  const from = String(req.query["from"] ?? "");
  const to = String(req.query["to"] ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    res.status(400).json({ error: "from and to must be YYYY-MM-DD" });
    return;
  }

  if (!isPlandayConfigured()) {
    res.json({
      available: false,
      from, to, rows: [], unmatchedAppUsers: [], unmatchedPlandayEmployees: [],
      shiftTypeNames: [], absenceAccountNames: [],
      activeShiftTypeNames: [], activeAbsenceAccountNames: [],
      shiftTypeIsUnpaid: {}, syncedAt: null, stale: false,
    } satisfies AttendanceResponse);
    return;
  }

  // 1. Load app users
  const appUsers = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      isActive: usersTable.isActive,
      plandayEmployeeId: usersTable.plandayEmployeeId,
    })
    .from(usersTable)
    .where(eq(usersTable.isActive, true));

  // 2. Lookups straight from Plan Day (small, 10-min cached in-process);
  // shifts + absences from the Postgres mirror, which only re-syncs what's
  // missing or recently editable — this is what turned minutes into instant
  // (Graeme, 2026-09-14). ?refresh=1 forces the trailing-window re-sync.
  const [plandayEmployees, shiftTypes, absenceAccounts, cached] = await Promise.all([
    getPlandayEmployees(),
    getPlandayShiftTypes(),
    getPlandayAbsenceAccounts(),
    getAttendanceFromCache(from, to, { forceFresh: String(req.query["refresh"] ?? "") === "1" }),
  ]);
  const { shifts, absences: absenceRecords, syncedAt, stale } = cached;

  // 3. Auto-match by email first, then fall back to first+last name matching.
  // Name fallback catches people whose Planday email doesn't match their app
  // login (e.g. Jane Miles logged in with a different username long before
  // Plan Day integration existed). First-name + last-name on the Planday
  // side compared to the app user's "name" field, both normalised.
  const emailToPlandayId = new Map<string, number>();
  const nameToPlandayId = new Map<string, number>();
  const normName = (s: string | null | undefined) =>
    (s ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim().replace(/\s+/g, " ");
  for (const e of plandayEmployees) {
    if (e.email) emailToPlandayId.set(e.email.toLowerCase().trim(), e.id);
    const fullName = normName(`${e.firstName ?? ""} ${e.lastName ?? ""}`);
    if (fullName) nameToPlandayId.set(fullName, e.id);
  }

  // Track which Planday IDs are already claimed so the name fallback can't
  // double-link — if two app users have the same name, first write wins and
  // the second stays unlinked rather than pointing at the wrong person.
  const claimedPlandayIds = new Set<number>();
  for (const u of appUsers) {
    if (u.plandayEmployeeId != null) claimedPlandayIds.add(u.plandayEmployeeId);
  }

  const updates: Array<{ userId: number; plandayId: number }> = [];
  for (const u of appUsers) {
    if (u.plandayEmployeeId != null) continue;
    const emailMatch = emailToPlandayId.get(u.email.toLowerCase().trim());
    const nameMatch = emailMatch == null ? nameToPlandayId.get(normName(u.name)) : null;
    const match = emailMatch ?? nameMatch ?? null;
    if (match != null && !claimedPlandayIds.has(match)) {
      u.plandayEmployeeId = match;
      claimedPlandayIds.add(match);
      updates.push({ userId: u.id, plandayId: match });
    }
  }
  if (updates.length > 0) {
    try {
      await Promise.all(updates.map(({ userId, plandayId }) =>
        db.update(usersTable)
          .set({ plandayEmployeeId: plandayId, updatedAt: new Date() })
          .where(eq(usersTable.id, userId)),
      ));
    } catch (err) {
      console.warn("[employees/attendance] failed to persist email matches:", err);
    }
  }

  // 4. Lookups
  const shiftTypeName = new Map<number, string>();
  for (const st of shiftTypes) shiftTypeName.set(st.id, st.name);
  const absenceAccountName = new Map<number, string>();
  for (const a of absenceAccounts) absenceAccountName.set(a.id, a.name);

  // 5. Aggregate per Plan Day employee
  interface Counts {
    total: number;
    late: number;
    totalAbsent: number;
    shiftTypes: Map<string, number>;      // shift type name → count
    absenceAccounts: Map<string, number>;  // absence account name → days
    // Sickness rolls up into ONE figure plus INSTANCES: Mon–Wed off sick
    // then back Thursday is one instance however many days it spanned
    // (Graeme, 2026-09-14). A run only splits when a WORKED shift breaks it.
    sickDates: string[];
    workedDates: string[];
  }
  const counts = new Map<number, Counts>();
  function getCounts(plandayId: number): Counts {
    let c = counts.get(plandayId);
    if (!c) {
      c = { total: 0, late: 0, totalAbsent: 0, shiftTypes: new Map(), absenceAccounts: new Map(), sickDates: [], workedDates: [] };
      counts.set(plandayId, c);
    }
    return c;
  }

  // Shifts — count total, bucket by shift type name, flag "late" ones, and
  // accumulate unpaid absences into the Total Absent rollup. In this setup
  // the absence types ("Sick Leave", "Dependants Leave", "Emergency Leave",
  // "Absent") are Plan Day shift types applied to a scheduled shift; paid
  // types like "Holiday (with Pay)" and non-absence types like "Training"
  // don't roll up.
  for (const s of shifts) {
    if (s.employeeId == null) continue;
    const c = getCounts(s.employeeId);
    c.total += 1;
    const name = s.shiftTypeId != null ? shiftTypeName.get(s.shiftTypeId) : undefined;
    const date = (s.date ?? "").slice(0, 10);
    if (name) {
      c.shiftTypes.set(name, (c.shiftTypes.get(name) ?? 0) + 1);
      if (isLateName(name)) c.late += 1;
      if (isAbsenceReasonName(name)) c.totalAbsent += 1;
      if (date) {
        if (isSickName(name)) c.sickDates.push(date);
        else if (!isAbsenceReasonName(name)) c.workedDates.push(date);
      }
    } else if (date) {
      // No shift type at all = a plain worked shift.
      c.workedDates.push(date);
    }
  }

  // Absence records — for setups that use the Absence API instead of (or in
  // addition to) shift types. Each registration day within the range is one
  // absence day, bucketed by its account name. Only accounts that describe
  // an absence REASON count: in this Planday the absence API is almost all
  // per-employee holiday accrual accounts, and holiday is planned time off,
  // not absence — counting it made "Total Absent" nonsense (2026-09-14).
  // Declined requests never count; pending ones do, so absence shows up
  // before the approval paperwork catches up.
  for (const r of absenceRecords) {
    if (r.employeeId == null) continue;
    if (r.status === "Declined") continue;

    const c = getCounts(r.employeeId);

    if (r.registrations && r.registrations.length > 0) {
      for (const reg of r.registrations) {
        if (!reg.date) continue;
        if (reg.date < from || reg.date > to) continue;
        const accName = reg.account?.id != null ? absenceAccountName.get(reg.account.id) : undefined;
        if (!accName) {
          if (reg.account?.id != null) console.warn(`[employees/attendance] absence record ${r.id} references unknown account ${reg.account.id} — skipped`);
          continue;
        }
        if (!isAbsenceReasonName(accName)) continue;
        c.absenceAccounts.set(accName, (c.absenceAccounts.get(accName) ?? 0) + 1);
        c.totalAbsent += 1;
      }
    } else if (r.absencePeriod?.start && r.absencePeriod.end) {
      const firstAccId = r.registrations?.[0]?.account?.id;
      const accName = firstAccId != null ? absenceAccountName.get(firstAccId) : undefined;
      if (!accName || !isAbsenceReasonName(accName)) continue;
      const days = clampToRange(r.absencePeriod.start, r.absencePeriod.end, from, to);
      if (days <= 0) continue;
      c.absenceAccounts.set(accName, (c.absenceAccounts.get(accName) ?? 0) + days);
      c.totalAbsent += days;
    }
  }

  // 6. Rows per app user
  const rows: EmployeeAttendanceRow[] = appUsers.map(u => {
    const c = u.plandayEmployeeId != null ? counts.get(u.plandayEmployeeId) : undefined;
    return {
      userId: u.id,
      userName: u.name,
      userEmail: u.email,
      role: u.role,
      plandayEmployeeId: u.plandayEmployeeId ?? null,
      linked: u.plandayEmployeeId != null,
      totalShifts: c?.total ?? 0,
      lateShifts: c?.late ?? 0,
      totalAbsent: c?.totalAbsent ?? 0,
      sickDays: c?.sickDates.length ?? 0,
      sickInstances: c ? countSickInstances(c.sickDates, c.workedDates) : 0,
      shiftTypeCounts: c ? Object.fromEntries(c.shiftTypes) : {},
      absenceAccountCounts: c ? Object.fromEntries(c.absenceAccounts) : {},
    };
  }).sort((a, b) => a.userName.localeCompare(b.userName));

  const unmatchedAppUsers = rows
    .filter(r => !r.linked)
    .map(r => ({ userId: r.userId, name: r.userName, email: r.userEmail }));

  // Planday employees not linked to any app user — new hires that need
  // inviting into the planner. We also skip anyone already claimed by the
  // email-or-name auto-matcher above. Dismissed ones (a manager said "this
  // person never needs a login") are flagged, not removed, so the UI can
  // hide them by default yet still restore.
  const dismissedIds = await readDismissedPlandayIds();
  const unmatchedPlandayEmployees = plandayEmployees
    .filter(e => !claimedPlandayIds.has(e.id))
    .map(e => ({
      plandayEmployeeId: e.id,
      name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || `Plan Day #${e.id}`,
      email: e.email ?? null,
      dismissed: dismissedIds.has(e.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const shiftTypeNames = Array.from(new Set(shiftTypes.map(s => s.name))).sort();
  const absenceAccountNames = Array.from(new Set(absenceAccounts.map(a => a.name))).sort();

  // Columns: absence reasons and "Arrived late" only — the report answers
  // "how much was someone absent and why", so Holiday (with Pay), Meeting
  // and Training columns aren't shown (Graeme, 2026-09-14). Absence-reason
  // columns always appear, even at zero: "Sick Leave" mustn't vanish from
  // the table during a healthy week — managers need to see the zero to know
  // they looked. Absence accounts only show reason-y ones with activity.
  // Sick types don't get per-type columns — they consolidate into the
  // dedicated "Sick leave" days + instances columns (Graeme, 2026-09-14).
  const activeShiftTypeNames = Array.from(new Set(
    shiftTypes.map(t => t.name).filter(n => (isAbsenceReasonName(n) && !isSickName(n)) || isLateName(n)),
  )).sort();
  const activeAbsenceAccountSet = new Set<string>();
  for (const r of rows) {
    if (!r.linked) continue;
    for (const [name, n] of Object.entries(r.absenceAccountCounts)) {
      if (n > 0) activeAbsenceAccountSet.add(name);
    }
  }
  const activeAbsenceAccountNames = Array.from(activeAbsenceAccountSet).sort();

  // Classify every shift type once, so the frontend can mark absence columns
  // red and match backend rollup behaviour without re-implementing the
  // heuristic. (Field keeps its historical name; it now means "counts toward
  // Total Absent".)
  const shiftTypeIsUnpaid: Record<string, boolean> = {};
  for (const name of activeShiftTypeNames) {
    shiftTypeIsUnpaid[name] = isAbsenceReasonName(name);
  }

  const response: AttendanceResponse = {
    available: true,
    from,
    to,
    rows,
    unmatchedAppUsers,
    unmatchedPlandayEmployees,
    shiftTypeNames,
    absenceAccountNames,
    activeShiftTypeNames,
    activeAbsenceAccountNames,
    shiftTypeIsUnpaid,
    syncedAt,
    stale,
  };
  res.json(response);
});

export default router;
