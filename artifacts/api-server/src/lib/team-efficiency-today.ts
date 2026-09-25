/**
 * Team efficiency — TODAY's live estimate (Objective I; pure, no I/O).
 *
 * A day's real figure waits until every Planday shift is approved (usually
 * the next morning). Until then this estimates it from what exists now:
 *
 *   - Labour so far: each punched-in Production shift, counted only up to
 *     now — its scheduled start to min(scheduled end, now) — less the unpaid
 *     breaks Planday has scheduled that have already started. Planday lists
 *     each unpaid break with its own start and end (the break rules that
 *     payroll then deducts), so "breaks already due" is read from those; a
 *     break without times is taken off in proportion to the shift elapsed.
 *     Pay = the shift's full break-deducted pay × (paid hours so far ÷ paid
 *     hours in the shift), × the on-cost multiplier.
 *   - Shifts nobody has punched in to yet cost nothing so far.
 *   - Value so far: the same rules as a finished day (deriveDay), on the
 *     packs counted so far and the orders despatched so far.
 *
 * Never stored: team_efficiency_days only ever holds approved figures.
 * CONFIDENTIAL: pounds, R and hours are the founder's; viewerToday() rebuilds
 * the estimate from an allow-list for everyone else.
 */
import { shiftPay, shiftPaidHours, isProductiveShift, type PlandayPayrollBreak } from "./team-efficiency";
import { productionDayFor, weekStart } from "./team-efficiency-labour";
import { deriveDay, type DayComponents, type TeSettings, type LineMade } from "./team-efficiency-day";

// ── Elapsed paid time ─────────────────────────────────────────────────────

export interface TimedBreak extends PlandayPayrollBreak {
  /** London local "YYYY-MM-DDTHH:mm[:ss]", when Planday gives it. */
  start?: string | null;
  end?: string | null;
}

export interface LiveShift {
  id: number;
  employeeId: number;
  date: string;
  positionId: number | null;
  /** Planday's salary for the whole shift (clock time × rate). */
  salary: number;
  /** London local "YYYY-MM-DDTHH:mm[:ss]" — Planday sends local times. */
  start: string;
  end: string;
  breaks: TimedBreak[];
}

/** London-local timestamp → a comparable number (ms, as if UTC). Both sides
 *  of every comparison go through this, so no timezone is ever applied. */
export function localMs(s: string): number {
  const t = s.length === 16 ? `${s}:00` : s.slice(0, 19);
  return Date.parse(`${t}Z`);
}

function overlapHours(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / 3_600_000;
}

/** Paid hours of a shift worked by `now` (London local timestamp). */
export function elapsedPaidHours(s: Pick<LiveShift, "start" | "end" | "breaks">, now: string): number {
  const start = localMs(s.start);
  const end = localMs(s.end);
  const cut = Math.min(end, localMs(now));
  if (!(cut > start)) return 0;
  const worked = (cut - start) / 3_600_000;
  const shiftHours = (end - start) / 3_600_000;
  let unpaid = 0;
  for (const b of s.breaks ?? []) {
    if (b.isPaid) continue;
    if (b.start && b.end) {
      unpaid += overlapHours(localMs(b.start), localMs(b.end), start, cut);
    } else if (shiftHours > 0) {
      unpaid += b.duration * (worked / shiftHours);
    }
  }
  return Math.max(0, worked - unpaid);
}

/** Break-deducted pay for the part of the shift worked by `now`. */
export function payToNow(s: LiveShift, now: string): number {
  const full = shiftPaidHours(s);
  if (full <= 0) return 0;
  return shiftPay(s) * Math.min(1, elapsedPaidHours(s, now) / full);
}

// ── Labour so far ─────────────────────────────────────────────────────────

/** Someone has actually clocked in to it (or it's already approved). */
export function isWorkedStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "punchclockstarted" || s === "punchclockfinished" || s === "approved";
}

export interface LiveLabourInputs {
  today: string;
  /** London local now, "YYYY-MM-DDTHH:mm:ss". */
  now: string;
  shifts: LiveShift[];
  /** Rota status and shift type by shift id. */
  rota: Map<number, { status: string | null; shiftTypeId: number | null }>;
  positions: Array<{ id: number; name: string; sectionId: number | null }>;
  shiftTypes: Array<{ id: number; name: string }>;
  shiftTypeByShiftId?: Map<number, number | null>;
  productionSectionId: number;
  sortedPlanDates: string[];
  nonDispatchDays: ReadonlySet<string>;
  linePositions: Record<string, string[]>;
  multipliers: Map<string, number>;
  fallbackMultiplier: number;
}

export interface LiveLabour {
  labourCostTotal: number;
  lineLabour: Record<string, number>;
  paidHours: number;
  headcount: number;
  /** Productive shifts counted (clocked in). */
  shiftsCounted: number;
  /** Productive shifts on the rota nobody has clocked in to yet. */
  shiftsNotStarted: number;
}

export function liveLabour(inp: LiveLabourInputs): LiveLabour {
  const posById = new Map(inp.positions.map(p => [p.id, p]));
  const typeName = new Map(inp.shiftTypes.map(t => [t.id, t.name]));
  const lineOf = new Map<string, string>();
  for (const [cat, names] of Object.entries(inp.linePositions)) for (const n of names) lineOf.set(n.trim().toLowerCase(), cat);

  const out: LiveLabour = { labourCostTotal: 0, lineLabour: {}, paidHours: 0, headcount: 0, shiftsCounted: 0, shiftsNotStarted: 0 };
  const heads = new Set<number>();
  for (const s of inp.shifts) {
    const date = s.date.slice(0, 10);
    if (productionDayFor(date, inp.sortedPlanDates, inp.nonDispatchDays) !== inp.today) continue;
    const rota = inp.rota.get(s.id);
    const typeId = rota?.shiftTypeId ?? inp.shiftTypeByShiftId?.get(s.id) ?? null;
    const pos = s.positionId != null ? posById.get(s.positionId) : undefined;
    if (!isProductiveShift(pos?.sectionId ?? null, inp.productionSectionId, typeId != null ? typeName.get(typeId) ?? null : null)) continue;
    if (!isWorkedStatus(rota?.status)) { out.shiftsNotStarted += 1; continue; }
    const mult = inp.multipliers.get(weekStart(date)) ?? inp.fallbackMultiplier;
    const cost = payToNow(s, inp.now) * mult;
    out.labourCostTotal += cost;
    out.paidHours += elapsedPaidHours(s, inp.now);
    out.shiftsCounted += 1;
    heads.add(s.employeeId);
    const line = pos ? lineOf.get(pos.name.trim().toLowerCase()) : undefined;
    if (line) out.lineLabour[line] = (out.lineLabour[line] ?? 0) + cost;
  }
  out.headcount = heads.size;
  return out;
}

// ── The estimate ──────────────────────────────────────────────────────────

export type TodayStatus = "estimate" | "waiting_for_counts" | "no_labour" | "no_plan";

export interface TodayEstimate {
  date: string;
  status: TodayStatus;
  /** Only when status is "estimate". */
  estimatePct: number | null;
  packsByLine: Record<string, number>;
  eightPackBags: number;
  ordersDespatched: number;
  packsDespatched: number;
  notes: string[];
  shiftsCounted: number;
  shiftsNotStarted: number;
  asOf: string;
  // ── founder-only ──
  valueCredited: number;
  labourCost: number;
  ratio: number | null;
  paidHours: number;
}

function countedSoFar(m: LineMade): number {
  return m.packs + (m.bagPacks ?? 0);
}

export function estimateToday(
  c: DayComponents, s: TeSettings, extra: { shiftsCounted: number; shiftsNotStarted: number; asOf: string; hasPlan: boolean },
): TodayEstimate {
  const d = deriveDay({ ...c, pendingShifts: 0, ignoredUnapproved: 0 }, s);
  // Mid-day, a line with nothing counted yet is normal — say so, don't exclude.
  const notes: string[] = [];
  for (const f of d.flags) {
    const m = f.line ? c.made[f.line] : undefined;
    if (f.code === "uncounted_output" && f.line) notes.push(`Nothing counted yet for ${f.line}`);
    else if (f.code === "partly_counted" && f.line && m) {
      notes.push(`${f.line}: ${Math.round(countedSoFar(m))} of ${Math.round(m.plannedPacks ?? 0)} planned packs counted so far`);
    } else if (f.code === "line_pay_removed") notes.push(f.message);
  }
  const ratio = d.labourCost > 0 ? d.valueCredited / d.labourCost : null;
  let status: TodayStatus = "estimate";
  if (!extra.hasPlan) status = "no_plan";
  else if (d.labourCost <= 0) status = "no_labour";
  else if (d.valueMadeNet <= 0) status = "waiting_for_counts";
  return {
    date: c.date,
    status,
    estimatePct: status === "estimate" && ratio != null && s.standardRatio > 0 ? (ratio / s.standardRatio) * 100 : null,
    packsByLine: d.packsByLine,
    eightPackBags: d.eightPackBags,
    ordersDespatched: c.ordersDespatched,
    packsDespatched: d.packsDespatched,
    notes,
    shiftsCounted: extra.shiftsCounted,
    shiftsNotStarted: extra.shiftsNotStarted,
    asOf: extra.asOf,
    valueCredited: d.valueCredited,
    labourCost: d.labourCost,
    ratio: status === "estimate" ? ratio : null,
    paidHours: c.paidHours,
  };
}

export type ViewerToday = Omit<TodayEstimate, "valueCredited" | "labourCost" | "ratio" | "paidHours">;

/** The estimate for managers/admins: allow-list, no pounds, R or hours. */
export function viewerToday(e: TodayEstimate): ViewerToday {
  return {
    date: e.date,
    status: e.status,
    estimatePct: e.estimatePct,
    packsByLine: { ...e.packsByLine },
    eightPackBags: e.eightPackBags,
    ordersDespatched: e.ordersDespatched,
    packsDespatched: e.packsDespatched,
    notes: [...e.notes],
    shiftsCounted: e.shiftsCounted,
    shiftsNotStarted: e.shiftsNotStarted,
    asOf: e.asOf,
  };
}
