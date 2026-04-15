/**
 * Employee records / attendance report.
 * Admin-only. Pulls data from Plan Day, auto-matches Plan Day employees to app
 * users by email, and summarises per user for a date range:
 *   - total shifts      (from Scheduling API)
 *   - arrived late      (shift type name contains "late")
 *   - sick              (absence account name contains "sick" but not "unpaid")
 *   - sick unpaid       (absence account name contains "sick" AND "unpaid")
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

// ── Admin auth ─────────────────────────────────────────────────────────────

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session.userRole === "admin") { next(); return; }
  if (req.session.userId && !req.session.userRole) {
    const [user] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, req.session.userId));
    if (user) {
      req.session.userRole = user.role as "admin" | "manager" | "viewer";
      if (user.role === "admin") { next(); return; }
    }
  }
  res.status(403).json({ error: "Admin access required" });
}

router.use(requireAdmin);

// ── Classification helpers ─────────────────────────────────────────────────

type ShiftCategory = "late" | "sick" | "sickUnpaid" | "other";

/**
 * Classifies a shift type or absence account name into a tracked category.
 * Late: name contains "late" (e.g. "Arrived late").
 * Sick: name contains "sick" (e.g. "Sick Leave"). If it also contains "unpaid",
 * it's classified as sickUnpaid.
 */
function classifyName(name: string | undefined): ShiftCategory {
  if (!name) return "other";
  const n = name.toLowerCase();
  if (n.includes("sick")) return n.includes("unpaid") ? "sickUnpaid" : "sick";
  if (n.includes("late")) return "late";
  return "other";
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
  sickShifts: number;
  sickUnpaidShifts: number;
}

interface AttendanceResponse {
  available: boolean;
  from: string;
  to: string;
  rows: EmployeeAttendanceRow[];
  unmatchedAppUsers: Array<{ userId: number; name: string; email: string }>;
  shiftTypeNames: string[];
  absenceAccountNames: string[];
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
      from, to, rows: [], unmatchedAppUsers: [],
      shiftTypeNames: [], absenceAccountNames: [],
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

  // 3. Auto-match by email — persist new matches
  const emailToPlandayId = new Map<string, number>();
  for (const e of plandayEmployees) {
    if (e.email) emailToPlandayId.set(e.email.toLowerCase().trim(), e.id);
  }
  const updates: Array<{ userId: number; plandayId: number }> = [];
  for (const u of appUsers) {
    if (u.plandayEmployeeId != null) continue;
    const match = emailToPlandayId.get(u.email.toLowerCase().trim());
    if (match != null) {
      u.plandayEmployeeId = match;
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
  interface Counts { total: number; late: number; sick: number; sickUnpaid: number }
  const counts = new Map<number, Counts>();
  function getCounts(plandayId: number): Counts {
    let c = counts.get(plandayId);
    if (!c) { c = { total: 0, late: 0, sick: 0, sickUnpaid: 0 }; counts.set(plandayId, c); }
    return c;
  }

  // Shifts — count total, and classify each shift by its shift type name.
  // In this setup, "Arrived late", "Sick Leave", etc. are shift types that
  // get applied to a person's scheduled shift for that day.
  for (const s of shifts) {
    if (s.employeeId == null) continue;
    const c = getCounts(s.employeeId);
    c.total += 1;
    const name = s.shiftTypeId != null ? shiftTypeName.get(s.shiftTypeId) : undefined;
    const cat = classifyName(name);
    if (cat === "late") c.late += 1;
    else if (cat === "sick") c.sick += 1;
    else if (cat === "sickUnpaid") c.sickUnpaid += 1;
  }

  // Absence records — for accounts setups that use the Absence API instead of
  // (or in addition to) shift types. Each registration day within the range
  // is one absence day, classified by its account name. We only add to sick /
  // sickUnpaid here — total shifts is already covered by the scheduling loop.
  for (const r of absenceRecords) {
    if (r.employeeId == null) continue;
    if (r.status !== "Approved") continue;

    let daysSick = 0;
    let daysSickUnpaid = 0;

    if (r.registrations && r.registrations.length > 0) {
      for (const reg of r.registrations) {
        if (!reg.date) continue;
        if (reg.date < from || reg.date > to) continue;
        const accName = reg.account?.id != null ? absenceAccountName.get(reg.account.id) : undefined;
        const cat = classifyName(accName);
        if (cat === "sick") daysSick += 1;
        else if (cat === "sickUnpaid") daysSickUnpaid += 1;
      }
    } else if (r.absencePeriod?.start && r.absencePeriod.end) {
      const firstAccId = r.registrations?.[0]?.account?.id;
      const accName = firstAccId != null ? absenceAccountName.get(firstAccId) : undefined;
      const cat = classifyName(accName);
      const days = clampToRange(r.absencePeriod.start, r.absencePeriod.end, from, to);
      if (cat === "sick") daysSick += days;
      else if (cat === "sickUnpaid") daysSickUnpaid += days;
    }

    if (daysSick > 0 || daysSickUnpaid > 0) {
      const c = getCounts(r.employeeId);
      c.sick += daysSick;
      c.sickUnpaid += daysSickUnpaid;
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
      sickShifts: c?.sick ?? 0,
      sickUnpaidShifts: c?.sickUnpaid ?? 0,
    };
  }).sort((a, b) => a.userName.localeCompare(b.userName));

  const unmatchedAppUsers = rows
    .filter(r => !r.linked)
    .map(r => ({ userId: r.userId, name: r.userName, email: r.userEmail }));

  const shiftTypeNames = Array.from(new Set(shiftTypes.map(s => s.name))).sort();
  const absenceAccountNames = Array.from(new Set(absenceAccounts.map(a => a.name))).sort();

  const response: AttendanceResponse = {
    available: true,
    from,
    to,
    rows,
    unmatchedAppUsers,
    shiftTypeNames,
    absenceAccountNames,
  };
  res.json(response);
});

export default router;
