/**
 * Planday API integration — fetches payroll data for labour cost calculations.
 * Caches access tokens for 55 minutes (they expire after 60).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── Config ─────────────────────────────────────────────────────────────────

const TOKEN_URL = "https://id.planday.com/connect/token";
const API_BASE = "https://openapi.planday.com";

function getConfig() {
  const clientId = process.env["PLANDAY_CLIENT_ID"];
  const refreshToken = process.env["PLANDAY_REFRESH_TOKEN"];
  const departmentId = process.env["PLANDAY_DEPARTMENT_ID"];
  if (!clientId || !refreshToken || !departmentId) return null;
  return { clientId, refreshToken, departmentId };
}

// ── Token cache ────────────────────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  const config = getConfig();
  if (!config) return null;

  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const body = `client_id=${config.clientId}&grant_type=refresh_token&refresh_token=${config.refreshToken}`;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    console.error("[planday] Token exchange failed:", res.status, await res.text());
    return null;
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000, // refresh 5 min early
  };
  return cachedToken.token;
}

// ── API helper ─────────────────────────────────────────────────────────────

async function plandayGet<T>(path: string, token: string): Promise<T | null> {
  const config = getConfig();
  if (!config) return null;

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-ClientId": config.clientId,
    },
  });

  if (!res.ok) {
    console.error(`[planday] GET ${path} failed:`, res.status);
    return null;
  }

  return res.json() as Promise<T>;
}

// ── Settings helpers ───────────────────────────────────────────────────────

async function getPnlSetting(key: string, defaultValue: number): Promise<number> {
  try {
    const rows = await db.execute<{ value: string }>(
      sql`SELECT value FROM pnl_settings WHERE key = ${key} LIMIT 1`,
    );
    const val = rows.rows[0]?.value;
    return val != null ? Number(val) : defaultValue;
  } catch {
    return defaultValue;
  }
}

// ── Payroll data types ─────────────────────────────────────────────────────

interface PlandayShiftPayroll {
  salary: number;
  start: string;
  end: string;
  supplements: Array<{ duration: number; modification: number }>;
  breaks: Array<{ duration: number; amount: number; isPaid: boolean }>;
  id: number;
  employeeId: number;
  date: string;
  wage: { rate: number; type: string };
  shiftDuration: string;
  departmentId: number;
}

interface PlandayPayrollResponse {
  shiftsPayroll: PlandayShiftPayroll[];
  supplementsPayroll?: Array<{ salary: number; employeeId: number; date: string }>;
  salariedPayroll?: Array<{ salary: number; employeeId: number; date: string }>;
  currencySymbol: string;
}

export interface ActualLabourResult {
  available: boolean;
  grossWages: number;
  employerNI: number;
  pension: number;
  totalCost: number;
  shiftCount: number;
  totalHours: number;
  costPerHour: number;
  settings: {
    niRate: number;
    niWeeklyThreshold: number;
    employmentAllowanceAnnual: number;
    pensionRate: number;
  };
}

// ── Main function ──────────────────────────────────────────────────────────

export async function getPayrollCosts(from: string, to: string): Promise<ActualLabourResult> {
  const unavailable: ActualLabourResult = {
    available: false, grossWages: 0, employerNI: 0, pension: 0,
    totalCost: 0, shiftCount: 0, totalHours: 0, costPerHour: 0,
    settings: { niRate: 0, niWeeklyThreshold: 0, employmentAllowanceAnnual: 0, pensionRate: 0 },
  };

  const config = getConfig();
  if (!config) return unavailable;

  const token = await getAccessToken();
  if (!token) return unavailable;

  // Fetch editable settings
  const [niRate, niWeeklyThreshold, allowanceAnnual, pensionRate] = await Promise.all([
    getPnlSetting("employer_ni_rate", 15),
    getPnlSetting("employer_ni_weekly_threshold", 96.15),
    getPnlSetting("employment_allowance_annual", 10500),
    getPnlSetting("employer_pension_rate", 3),
  ]);

  // Fetch payroll from Planday
  const data = await plandayGet<PlandayPayrollResponse>(
    `/payroll/v1.0/payroll?departmentIds=${config.departmentId}&from=${from}&to=${to}&shiftStatus=Approved`,
    token,
  );
  if (!data) return unavailable;

  const shifts = data.shiftsPayroll ?? [];
  if (shifts.length === 0) return { ...unavailable, available: true, settings: { niRate, niWeeklyThreshold, employmentAllowanceAnnual: allowanceAnnual, pensionRate } };

  // Calculate gross wages (Planday's pre-calculated salary per shift, breaks already deducted)
  const grossWages = shifts.reduce((sum, s) => sum + s.salary, 0);

  // Calculate total hours from shift durations
  let totalHours = 0;
  for (const s of shifts) {
    const start = new Date(s.start);
    const end = new Date(s.end);
    const shiftHours = (end.getTime() - start.getTime()) / 3600000;
    // Subtract unpaid breaks
    const unpaidBreakHours = s.breaks
      .filter(b => !b.isPaid)
      .reduce((sum, b) => sum + b.duration, 0);
    totalHours += Math.max(0, shiftHours - unpaidBreakHours);
  }

  // Calculate period in weeks for NI threshold calculation
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const daysInRange = Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  const weeksInRange = daysInRange / 7;

  // Group wages by employee for NI calculation
  const wagesByEmployee = new Map<number, number>();
  for (const s of shifts) {
    wagesByEmployee.set(s.employeeId, (wagesByEmployee.get(s.employeeId) ?? 0) + s.salary);
  }

  // Calculate employer's NI per employee
  // NI = max(0, (employee_total_wages - (weekly_threshold × weeks_in_range))) × rate%
  let totalNIBeforeAllowance = 0;
  for (const [, empWages] of wagesByEmployee) {
    const threshold = niWeeklyThreshold * weeksInRange;
    const niableAmount = Math.max(0, empWages - threshold);
    totalNIBeforeAllowance += niableAmount * (niRate / 100);
  }

  // Apply Employment Allowance (pro-rated for the period)
  const proratedAllowance = allowanceAnnual * (daysInRange / 365);
  const employerNI = Math.max(0, totalNIBeforeAllowance - proratedAllowance);

  // Pension: simple percentage of gross wages
  const pension = grossWages * (pensionRate / 100);

  const totalCost = grossWages + employerNI + pension;
  const costPerHour = totalHours > 0 ? totalCost / totalHours : 0;

  return {
    available: true,
    grossWages: Math.round(grossWages * 100) / 100,
    employerNI: Math.round(employerNI * 100) / 100,
    pension: Math.round(pension * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    shiftCount: shifts.length,
    totalHours: Math.round(totalHours * 10) / 10,
    costPerHour: Math.round(costPerHour * 100) / 100,
    settings: { niRate, niWeeklyThreshold, employmentAllowanceAnnual: allowanceAnnual, pensionRate },
  };
}

export function isPlandayConfigured(): boolean {
  return getConfig() !== null;
}
