/**
 * Improvement time doesn't cost the team on their KPIs (Graeme, 27 Nov 2026:
 * "If the packing and wrapping team do 3 improvements, we reward them … it
 * doesn't negatively affect their KPIs if it slows them down … 10 minutes.
 * If someone does 6 improvements, that basically knocks out an hour of their
 * production time at 100% efficiency"). Objective E.
 *
 * The rules, all here and pure (services/improvement-kpi-credit.ts reads the
 * data):
 *
 *   - Which improvements: the ones DONE on that London day — the same
 *     definition as the "improvements completed" KPI
 *     (lib/improvements-completed.ts): progress status awaiting_approval or
 *     complete, bucketed by done_at. Ideas, sent-back (rejected) ones and
 *     legacy rows with no done_at never count.
 *   - Who: everyone credited on it (the lead + improvement_credits rows,
 *     lib/db improvement-credits.ts). Each credited person earns the set
 *     minutes (default 10): two people on one improvement = 20 minutes.
 *   - Which KPI: decided by the person's Planday shift that day.
 *       a Packer / Wrapper shift (the room's positions)   → the packing &
 *                                                           wrapping room score
 *       any other shift in Planday's Production section   → the TCK run rate
 *       no productive shift that day (or not linked to
 *       Planday, or training/meeting/leave only)          → no KPI credit
 *     Someone on both a room shift and another production shift is counted
 *     on the room: their hours are in the room's paid hours.
 *   - How it applies:
 *       ROOM: the minutes become earned hours AT THE 100% LINE — minutes ×
 *       the standard ratio — so the improvement time scores exactly 100%.
 *       (The room's 100% line is a ratio of earned to paid hours well under
 *       1, because set-up, mayos and clean-down aren't measured. Crediting the
 *       raw minutes would score improvement time above 100%.)
 *       RUN RATE: the minutes come off the day's production time, like the
 *       snack and lunch deductions. Batches are never changed.
 *       Either way the credit can never be more than HALF the day (half the
 *       production time after breaks; half the room's paid hours), so a
 *       burst of improvements logged at once can't turn a day into nonsense.
 *   - Boxes per hour and packs wrapped per hour are never touched.
 */
import { isProductiveShift } from "./team-efficiency";
import { londonDateString } from "./london-time";

export const IMPROVEMENT_KPI_MINUTES_SETTING = "improvement_kpi_minutes";
export const DEFAULT_IMPROVEMENT_KPI_MINUTES = 10;
export const MAX_IMPROVEMENT_KPI_MINUTES = 120;
/** The credit never removes / adds more than this share of the day. */
export const MAX_DAY_SHARE = 0.5;

/** The minutes setting from app_settings; anything unusable is the default. */
export function parseImprovementMinutes(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_IMPROVEMENT_KPI_MINUTES;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= MAX_IMPROVEMENT_KPI_MINUTES ? n : DEFAULT_IMPROVEMENT_KPI_MINUTES;
}

// ── Inputs ────────────────────────────────────────────────────────────────

/** One (improvement, credited person) pair. */
export interface CreditedImprovement {
  improvementId: number;
  progressStatus: string;
  doneAt: Date | null;
  userId: number;
  name: string | null;
}

/** One Planday rota shift (from the attendance mirror). */
export interface CreditShift {
  employeeId: number | null;
  date: string;
  positionName: string | null;
  positionSectionId: number | null;
  shiftTypeName: string | null;
}

export type CreditTeam = "room" | "runRate";
export type NotCountedReason = "no-shift" | "not-linked" | "other-shift" | "planday-unavailable";

/** The progress statuses that mean the work was carried out (same as the
 *  improvements-completed KPI). */
const DONE = new Set(["awaiting_approval", "complete"]);

/**
 * Which KPI a person's day counts towards, from their shifts that day.
 * Room positions are matched by name (case-insensitive); production is
 * Planday's Production section. Training, meetings, holiday and sickness
 * shifts are never productive time.
 */
export function teamForShifts(
  shifts: ReadonlyArray<CreditShift>,
  roomPositions: readonly string[],
  productionSectionId: number | null,
): CreditTeam | null {
  const room = new Set(roomPositions.map(p => p.trim().toLowerCase()));
  let production = false;
  for (const s of shifts) {
    if (!isProductiveShift(0, 0, s.shiftTypeName)) continue;
    if (s.positionName && room.has(s.positionName.trim().toLowerCase())) return "room";
    if (productionSectionId != null && s.positionSectionId === productionSectionId) production = true;
  }
  return production ? "runRate" : null;
}

// ── Output ────────────────────────────────────────────────────────────────

export interface PersonCredit {
  userId: number;
  name: string | null;
  improvements: number;
  minutes: number;
}

export interface TeamCredit {
  /** Distinct improvements behind the credit. */
  improvements: number;
  /** Minutes credited before any cap (credited people × minutes). */
  minutes: number;
  people: PersonCredit[];
  /** Each credit's moment, for the through-the-day view. */
  events: Array<{ at: string; minutes: number }>;
}

export interface NotCounted extends PersonCredit {
  reason: NotCountedReason;
}

export interface DayCredit {
  date: string;
  room: TeamCredit;
  runRate: TeamCredit;
  /** Done improvements whose person had no shift that counts. */
  notCounted: NotCounted[];
}

const emptyTeam = (): TeamCredit => ({ improvements: 0, minutes: 0, people: [], events: [] });
export const emptyDayCredit = (date: string): DayCredit => ({ date, room: emptyTeam(), runRate: emptyTeam(), notCounted: [] });

export interface CreditInputs {
  rows: ReadonlyArray<CreditedImprovement>;
  /** app user → Planday employee id. Missing / null = not linked. */
  plandayIdByUser: ReadonlyMap<number, number | null>;
  shifts: ReadonlyArray<CreditShift>;
  roomPositions: readonly string[];
  productionSectionId: number | null;
  minutesPerImprovement: number;
  /** False when the rota couldn't be read: nothing is credited. */
  shiftsKnown: boolean;
  /** Inclusive London-day range. */
  from: string;
  to: string;
}

/** Each London day's credit, split by team. Only days with a done
 *  improvement are in the map. */
export function improvementCreditByDay(i: CreditInputs): Map<string, DayCredit> {
  const shiftsByEmpDay = new Map<string, CreditShift[]>();
  for (const s of i.shifts) {
    if (s.employeeId == null) continue;
    const key = `${s.employeeId}|${s.date.slice(0, 10)}`;
    const list = shiftsByEmpDay.get(key);
    if (list) list.push(s); else shiftsByEmpDay.set(key, [s]);
  }

  const out = new Map<string, DayCredit>();
  const improvementsSeen = new Map<string, Set<number>>(); // `${date}|${team}` → ids
  const seenPair = new Set<string>();
  for (const r of i.rows) {
    if (!DONE.has(r.progressStatus) || !r.doneAt) continue;
    const date = londonDateString(r.doneAt);
    if (date < i.from || date > i.to) continue;
    const pairKey = `${r.improvementId}|${r.userId}`;
    if (seenPair.has(pairKey)) continue; // each person once per improvement
    seenPair.add(pairKey);

    const day = out.get(date) ?? emptyDayCredit(date);
    out.set(date, day);
    const minutes = i.minutesPerImprovement;

    const emp = i.plandayIdByUser.get(r.userId) ?? null;
    let reason: NotCountedReason | null = null;
    let team: CreditTeam | null = null;
    if (!i.shiftsKnown) reason = "planday-unavailable";
    else if (emp == null) reason = "not-linked";
    else {
      const shifts = shiftsByEmpDay.get(`${emp}|${date}`) ?? [];
      team = teamForShifts(shifts, i.roomPositions, i.productionSectionId);
      if (!team) reason = shifts.length ? "other-shift" : "no-shift";
    }

    if (!team) {
      const existing = day.notCounted.find(p => p.userId === r.userId && p.reason === reason);
      if (existing) { existing.improvements += 1; existing.minutes += minutes; }
      else day.notCounted.push({ userId: r.userId, name: r.name, improvements: 1, minutes, reason: reason! });
      continue;
    }

    const t = day[team];
    t.minutes += minutes;
    t.events.push({ at: r.doneAt.toISOString(), minutes });
    const person = t.people.find(p => p.userId === r.userId);
    if (person) { person.improvements += 1; person.minutes += minutes; if (!person.name && r.name) person.name = r.name; }
    else t.people.push({ userId: r.userId, name: r.name, improvements: 1, minutes });
    const seenKey = `${date}|${team}`;
    const ids = improvementsSeen.get(seenKey) ?? new Set<number>();
    ids.add(r.improvementId);
    improvementsSeen.set(seenKey, ids);
    t.improvements = ids.size;
  }
  for (const d of out.values()) {
    for (const t of [d.room, d.runRate]) {
      t.people.sort((a, b) => b.minutes - a.minutes || (a.name ?? "").localeCompare(b.name ?? ""));
      t.events.sort((a, b) => a.at.localeCompare(b.at));
    }
  }
  return out;
}

/** Several days' credit for one team added up (a period's breakdown). */
export function sumTeamCredit(teams: ReadonlyArray<TeamCredit>): TeamCredit {
  const out = emptyTeam();
  const byUser = new Map<number, PersonCredit>();
  for (const t of teams) {
    out.improvements += t.improvements;
    out.minutes += t.minutes;
    out.events.push(...t.events);
    for (const p of t.people) {
      const e = byUser.get(p.userId);
      if (e) { e.improvements += p.improvements; e.minutes += p.minutes; if (!e.name && p.name) e.name = p.name; }
      else byUser.set(p.userId, { ...p });
    }
  }
  out.people = [...byUser.values()].sort((a, b) => b.minutes - a.minutes || (a.name ?? "").localeCompare(b.name ?? ""));
  out.events.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

// ── Applying it ───────────────────────────────────────────────────────────

/**
 * Run rate: the minutes that come off production time — the credit, but
 * never more than half the production time left after breaks.
 */
export function runRateCreditMinutes(creditMinutes: number, activeMinutes: number): number {
  if (!(creditMinutes > 0) || !(activeMinutes > 0)) return 0;
  return Math.min(creditMinutes, activeMinutes * MAX_DAY_SHARE);
}

/**
 * Room: the earned hours the credit is worth — the minutes (never more than
 * half the room's paid hours) at the 100% line. No 100% line yet (or no paid
 * hours) = nothing, because there is no score for it to protect.
 */
export function roomCreditEarnedHours(creditMinutes: number, paidHours: number, standardRatio: number | null): number {
  if (!(creditMinutes > 0) || !(paidHours > 0) || !standardRatio || standardRatio <= 0) return 0;
  const minutes = Math.min(creditMinutes, paidHours * 60 * MAX_DAY_SHARE);
  return (minutes / 60) * standardRatio;
}

/** The room credit's minutes after the half-day cap (for the breakdown). */
export function roomCreditMinutesApplied(creditMinutes: number, paidHours: number): number {
  if (!(creditMinutes > 0) || !(paidHours > 0)) return 0;
  return Math.min(creditMinutes, paidHours * 60 * MAX_DAY_SHARE);
}

/** What a screen shows beside a score: the credit and its effect. */
export interface CreditSummary {
  improvements: number;
  /** Minutes credited (people × minutes per improvement). */
  minutes: number;
  /** Minutes that counted after the half-day cap. */
  minutesApplied: number;
  people: PersonCredit[];
}

export function creditSummary(t: TeamCredit | undefined, minutesApplied: number): CreditSummary {
  return {
    improvements: t?.improvements ?? 0,
    minutes: t?.minutes ?? 0,
    minutesApplied: Math.round(minutesApplied * 10) / 10,
    people: t?.people ?? [],
  };
}

/** A room day with its improvement credit attached as earned hours. */
export function roomDayWithCredit<T extends { paidHours: number }>(
  d: T,
  credit: TeamCredit | undefined,
  standardRatio: number | null,
): T & { improvementHours: number; improvementCredit: CreditSummary } {
  const minutes = credit?.minutes ?? 0;
  return {
    ...d,
    improvementHours: roomCreditEarnedHours(minutes, d.paidHours, standardRatio),
    improvementCredit: creditSummary(credit, roomCreditMinutesApplied(minutes, d.paidHours)),
  };
}
