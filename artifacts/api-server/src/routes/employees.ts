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
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getPlandayEmployees,
  getPlandayShifts,
  getPlandayShiftTypes,
  getPlandayAbsenceRecords,
  getPlandayAbsenceAccounts,
  isPlandayConfigured,
} from "../services/planday";

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

/**
 * The only special-cased category left — "Arrived late" still shows on the
 * summary cards because it's the headline metric managers look at. Every
 * other shift type / absence account is returned verbatim so the frontend
 * can render one column per type.
 */
function isLateName(name: string | undefined): boolean {
  if (!name) return false;
  return name.toLowerCase().includes("late");
}

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
  // anyone's created them a login in the planner.
  unmatchedPlandayEmployees: Array<{ plandayEmployeeId: number; name: string; email: string | null }>;
  shiftTypeNames: string[];
  absenceAccountNames: string[];
  // Column drivers for the frontend table — names that have at least one
  // non-zero count across linked employees in the range. Sorted alpha.
  activeShiftTypeNames: string[];
  activeAbsenceAccountNames: string[];
}

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

  // 2. Fetch Plan Day data in parallel
  const [plandayEmployees, shiftTypes, shifts, absenceRecords, absenceAccounts] = await Promise.all([
    getPlandayEmployees(),
    getPlandayShiftTypes(),
    getPlandayShifts(from, to),
    getPlandayAbsenceRecords(from, to),
    getPlandayAbsenceAccounts(),
  ]);

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
  }
  const counts = new Map<number, Counts>();
  function getCounts(plandayId: number): Counts {
    let c = counts.get(plandayId);
    if (!c) {
      c = { total: 0, late: 0, totalAbsent: 0, shiftTypes: new Map(), absenceAccounts: new Map() };
      counts.set(plandayId, c);
    }
    return c;
  }

  // Shifts — count total, bucket by shift type name, and flag "late" ones.
  // In this setup, "Arrived late", "Sick Leave", etc. are shift types that
  // get applied to a person's scheduled shift for that day.
  for (const s of shifts) {
    if (s.employeeId == null) continue;
    const c = getCounts(s.employeeId);
    c.total += 1;
    const name = s.shiftTypeId != null ? shiftTypeName.get(s.shiftTypeId) : undefined;
    if (name) {
      c.shiftTypes.set(name, (c.shiftTypes.get(name) ?? 0) + 1);
      if (isLateName(name)) c.late += 1;
    }
  }

  // Absence records — for setups that use the Absence API instead of (or in
  // addition to) shift types. Each registration day within the range is one
  // absence day, bucketed by its account name. totalAbsent is the grand total
  // across every account type (sick, dependency leave, emergency leave, etc.).
  for (const r of absenceRecords) {
    if (r.employeeId == null) continue;
    if (r.status !== "Approved") continue;

    const c = getCounts(r.employeeId);

    if (r.registrations && r.registrations.length > 0) {
      for (const reg of r.registrations) {
        if (!reg.date) continue;
        if (reg.date < from || reg.date > to) continue;
        const accName = reg.account?.id != null ? absenceAccountName.get(reg.account.id) : undefined;
        if (!accName) continue;
        c.absenceAccounts.set(accName, (c.absenceAccounts.get(accName) ?? 0) + 1);
        c.totalAbsent += 1;
      }
    } else if (r.absencePeriod?.start && r.absencePeriod.end) {
      const firstAccId = r.registrations?.[0]?.account?.id;
      const accName = firstAccId != null ? absenceAccountName.get(firstAccId) : undefined;
      if (!accName) continue;
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
      shiftTypeCounts: c ? Object.fromEntries(c.shiftTypes) : {},
      absenceAccountCounts: c ? Object.fromEntries(c.absenceAccounts) : {},
    };
  }).sort((a, b) => a.userName.localeCompare(b.userName));

  const unmatchedAppUsers = rows
    .filter(r => !r.linked)
    .map(r => ({ userId: r.userId, name: r.userName, email: r.userEmail }));

  // Planday employees not linked to any app user — new hires that need
  // inviting into the planner. We also skip anyone already claimed by the
  // email-or-name auto-matcher above.
  const unmatchedPlandayEmployees = plandayEmployees
    .filter(e => !claimedPlandayIds.has(e.id))
    .map(e => ({
      plandayEmployeeId: e.id,
      name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || `Plan Day #${e.id}`,
      email: e.email ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const shiftTypeNames = Array.from(new Set(shiftTypes.map(s => s.name))).sort();
  const absenceAccountNames = Array.from(new Set(absenceAccounts.map(a => a.name))).sort();

  // Only surface columns that actually have activity in the range — keeps
  // the table narrow enough to read on an iPad. An empty shift type like
  // "Holiday" with no instances doesn't earn a column.
  const activeShiftTypeSet = new Set<string>();
  const activeAbsenceAccountSet = new Set<string>();
  for (const r of rows) {
    if (!r.linked) continue;
    for (const [name, n] of Object.entries(r.shiftTypeCounts)) {
      if (n > 0) activeShiftTypeSet.add(name);
    }
    for (const [name, n] of Object.entries(r.absenceAccountCounts)) {
      if (n > 0) activeAbsenceAccountSet.add(name);
    }
  }
  const activeShiftTypeNames = Array.from(activeShiftTypeSet).sort();
  const activeAbsenceAccountNames = Array.from(activeAbsenceAccountSet).sort();

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
  };
  res.json(response);
});

export default router;
