/**
 * Team efficiency — gathers TODAY's live estimate (Objective I). Rules live
 * in lib/team-efficiency-today.ts; this only reads Postgres, Planday and the
 * orders mirror. Read-only everywhere, and NEVER writes team_efficiency_days
 * (that table only ever holds approved figures).
 *
 * Planday calls per refresh (cached 3 minutes, shared by every viewer):
 *   - payroll for the last few days WITHOUT the Approved filter (Planday
 *     prices unapproved shifts from the schedule, with scheduled breaks);
 *   - the rota for the same days (who has clocked in);
 *   - last week's approved payroll, once per hour, for the on-cost
 *     multiplier (NI works on a person's whole week, so a finished week).
 */
import {
  getPlandayPayrollRows, getPlandayShifts, getPlandayPositions, getPlandaySections,
  getPlandayShiftTypes, getEmployerCostSettings, isPlandayConfigured,
} from "./planday";
import { londonDateString, londonLocalTimestamp } from "../lib/london-time";
import { ensureOrdersFresh } from "../lib/orders-cache";
import { madeByLine, type DayComponents } from "../lib/team-efficiency-day";
import { addDaysIso, weekStart, weeklyOnCostMultipliers, type PayrollRowInput } from "../lib/team-efficiency-labour";
import { onCostMultiplier } from "../lib/team-efficiency";
import { liveLabour, estimateToday, type LiveShift, type TodayEstimate } from "../lib/team-efficiency-today";
import {
  loadSettings, planDatesAround, nonDispatchDays, planItems, despatchInputs, mirrorShiftTypes,
} from "./team-efficiency-job";

const CACHE_MS = 3 * 60_000;
const MULT_CACHE_MS = 60 * 60_000;
/** Rest days before today whose shifts count towards today (a long weekend). */
const LOOKBACK_DAYS = 4;

let cached: { at: number; date: string; value: TodayEstimate | null; unavailable?: string } | null = null;
let inflight: Promise<TodayResult> | null = null;
let multCache: { at: number; week: string; value: number } | null = null;

export type TodayResult = { estimate: TodayEstimate } | { unavailable: string };

async function lastWeekMultiplier(today: string, onCost: Parameters<typeof weeklyOnCostMultipliers>[1]): Promise<number> {
  const week = addDaysIso(weekStart(today), -7);
  if (multCache && multCache.week === week && Date.now() - multCache.at < MULT_CACHE_MS) return multCache.value;
  const rows = await getPlandayPayrollRows(week, addDaysIso(week, 6));
  const fallback = onCostMultiplier(0, onCost);
  if (!rows) return fallback; // Planday hiccup: holiday + pension only, not cached
  const input: PayrollRowInput[] = rows.map(r => ({
    id: r.id, employeeId: r.employeeId, date: r.date, positionId: r.positionId ?? null,
    salary: r.salary, start: r.start, end: r.end, breaks: r.breaks ?? [],
  }));
  const value = weeklyOnCostMultipliers(input, onCost).get(week) ?? fallback;
  multCache = { at: Date.now(), week, value };
  return value;
}

async function compute(): Promise<TodayResult> {
  if (!isPlandayConfigured()) return { unavailable: "Planday isn't connected" };
  const today = londonDateString();
  const now = londonLocalTimestamp();
  const from = addDaysIso(today, -LOOKBACK_DAYS);

  const settings = await loadSettings();
  const planDates = await planDatesAround(today, today);
  const hasPlan = planDates.includes(today);

  const [positions, sections, shiftTypes, employer] = await Promise.all([
    getPlandayPositions(), getPlandaySections(), getPlandayShiftTypes(), getEmployerCostSettings(),
  ]);
  const section = sections.find(s => s.name.trim().toLowerCase() === settings.productionSection.toLowerCase());
  if (!section) return { unavailable: `Planday section "${settings.productionSection}" not found` };

  const [payroll, rota] = await Promise.all([
    getPlandayPayrollRows(from, today, { approvedOnly: false }),
    getPlandayShifts(from, today),
  ]);
  if (!payroll) return { unavailable: "Couldn't reach Planday for today's shifts" };

  const onCost = { ...employer, holidayAccrual: settings.holidayAccrual };
  const mult = await lastWeekMultiplier(today, onCost);
  const shifts: LiveShift[] = payroll.map(r => ({
    id: r.id, employeeId: r.employeeId, date: r.date, positionId: r.positionId ?? null,
    salary: r.salary, start: r.start, end: r.end, breaks: r.breaks ?? [],
  }));
  const labour = liveLabour({
    today, now, shifts,
    rota: new Map(rota.map(s => [s.id, { status: s.status ?? null, shiftTypeId: s.shiftTypeId ?? null }])),
    positions: positions.map(p => ({ id: p.id, name: p.name, sectionId: p.sectionId ?? null })),
    shiftTypes,
    shiftTypeByShiftId: await mirrorShiftTypes(from, today),
    productionSectionId: section.id,
    sortedPlanDates: planDates,
    nonDispatchDays: await nonDispatchDays(),
    linePositions: settings.linePositions,
    // This week's NI can't be known until the week ends: use last week's
    // multiplier for every shift (the stored figure is exact).
    multipliers: new Map(),
    fallbackMultiplier: mult,
  });

  // Orders mirror: bring it up to date first (read-only Shopify, 30 s
  // freshness); serve what's there if Shopify is slow.
  try { await ensureOrdersFresh(addDaysIso(today, -28)); } catch (err) {
    console.warn("[team-efficiency] orders mirror refresh failed, using it as-is:", err instanceof Error ? err.message : err);
  }
  const [items, despatch] = await Promise.all([planItems(today, today), despatchInputs(today, today, 28)]);
  const dsp = despatch.get(today);
  const c: DayComponents = {
    date: today,
    made: madeByLine(items.get(today) ?? []),
    despatched: dsp?.lines ?? {},
    ordersDespatched: dsp?.orders ?? 0,
    labourCostTotal: labour.labourCostTotal,
    lineLabour: labour.lineLabour,
    paidHours: labour.paidHours,
    headcount: labour.headcount,
    pendingShifts: 0,
    ignoredUnapproved: 0,
  };
  return {
    estimate: estimateToday(c, settings, {
      shiftsCounted: labour.shiftsCounted,
      shiftsNotStarted: labour.shiftsNotStarted,
      asOf: new Date().toISOString(),
      hasPlan,
    }),
  };
}

/** Today's estimate, cached for 3 minutes; one computation at a time. */
export async function todayEstimate(): Promise<TodayResult> {
  const today = londonDateString();
  if (cached && cached.date === today && Date.now() - cached.at < CACHE_MS) {
    return cached.value ? { estimate: cached.value } : { unavailable: cached.unavailable ?? "Not available" };
  }
  if (inflight) return inflight;
  inflight = compute()
    .then(r => {
      cached = { at: Date.now(), date: today, value: "estimate" in r ? r.estimate : null, unavailable: "unavailable" in r ? r.unavailable : undefined };
      return r;
    })
    .finally(() => { inflight = null; });
  return inflight;
}
