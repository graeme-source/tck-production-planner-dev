/**
 * Improvement score (Graeme, 2026-10-12; Objectives E and H).
 *
 * The aim is one small, meaningful improvement per shift, so beside the
 * plain count each person gets a score:
 *
 *     credits in the last 30 days ÷ shifts worked in the last 30 days
 *
 * as a whole-number percentage — one improvement per shift is 100%.
 * Someone on 2 shifts a week doing 4 scores 200%; someone on 5 shifts doing
 * 8 scores 160%. The score is NOT capped (the screen may cap a bar).
 *
 * Credits: every improvement is worth 1, and the founder can mark a really
 * good one ×2 or a really substantial one ×3 (improvement_submissions.
 * credit_weight, migration 0171). Everyone credited on a shared improvement
 * gets its full credits — the same rule as the all-time tally (0125).
 *
 * Shifts worked: distinct days in the window with a Planday rota shift the
 * person actually clocked in to (or that was approved), leaving out holiday,
 * sickness and other leave shift types. Two shifts on one day count as one —
 * a split shift is still one day's chance to improve something.
 *
 * Pure: no database, no Planday. services/improvement-score.ts feeds it.
 */
import { isWorkedStatus } from "./team-efficiency-today";
import { leaveKindForShiftType } from "./hours-worked";

export const SCORE_WINDOW_DAYS = 30;
export const CREDIT_WEIGHTS = [1, 2, 3] as const;
export type CreditWeight = (typeof CREDIT_WEIGHTS)[number];

/** What each weight is called on the badge and the founder's buttons. */
export const CREDIT_WEIGHT_LABEL: Record<CreditWeight, string> = {
  1: "Standard",
  2: "Great one",
  3: "Substantial",
};

/** Anything stored or sent that isn't 2 or 3 is a plain 1. */
export function normaliseCreditWeight(n: unknown): CreditWeight {
  const v = Number(n);
  return v === 2 || v === 3 ? v : 1;
}

export interface ScoreWindow { from: string; to: string }

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The rolling window: the last 30 London days, today included. */
export function scoreWindow(today: string, days: number = SCORE_WINDOW_DAYS): ScoreWindow {
  return { from: addDays(today, -(days - 1)), to: today };
}

function inWindow(date: string, w: ScoreWindow): boolean {
  const d = date.slice(0, 10);
  return d >= w.from && d <= w.to;
}

/** One person's credit on one improvement, dated by the London day it was done. */
export interface CreditPair {
  improvementId: number;
  userId: number;
  weight: number;
  /** "YYYY-MM-DD" (London) — when it was marked done. */
  doneDate: string;
}

/** A rota shift from the Planday mirror. */
export interface RotaShift {
  employeeId: number | null;
  date: string;
  status: string | null;
  shiftTypeName: string | null;
}

/** Credits (and how many improvements they came from) per app user in the window. */
export function creditsByUser(pairs: ReadonlyArray<CreditPair>, w: ScoreWindow): Map<number, { credits: number; improvements: number }> {
  const out = new Map<number, { credits: number; improvements: number }>();
  const seen = new Set<string>();
  for (const p of pairs) {
    if (!inWindow(p.doneDate, w)) continue;
    const key = `${p.improvementId}:${p.userId}`;
    if (seen.has(key)) continue; // one credit per person per improvement
    seen.add(key);
    const cur = out.get(p.userId) ?? { credits: 0, improvements: 0 };
    cur.credits += normaliseCreditWeight(p.weight);
    cur.improvements += 1;
    out.set(p.userId, cur);
  }
  return out;
}

/** Distinct days actually worked, per Planday employee, in the window. */
export function shiftsWorkedByEmployee(shifts: ReadonlyArray<RotaShift>, w: ScoreWindow): Map<number, number> {
  const days = new Map<number, Set<string>>();
  for (const s of shifts) {
    if (s.employeeId == null || !inWindow(s.date, w)) continue;
    if (!isWorkedStatus(s.status)) continue;
    if (leaveKindForShiftType(s.shiftTypeName)) continue;
    const set = days.get(s.employeeId) ?? new Set<string>();
    set.add(s.date.slice(0, 10));
    days.set(s.employeeId, set);
  }
  return new Map([...days].map(([id, set]) => [id, set.size]));
}

/** credits ÷ shifts as a whole percentage; null when there were no shifts. */
export function improvementScorePct(credits: number, shifts: number): number | null {
  if (!(shifts > 0)) return null;
  return Math.round((credits / shifts) * 100);
}

export interface PersonScore {
  userId: number;
  credits: number;
  improvements: number;
  /** null = not linked to Planday, so we can't know their shifts. */
  shifts: number | null;
  /** null = no shifts to divide by — shown as "—". */
  scorePct: number | null;
}

export function buildScores(input: {
  users: ReadonlyArray<{ userId: number; plandayEmployeeId: number | null }>;
  pairs: ReadonlyArray<CreditPair>;
  shifts: ReadonlyArray<RotaShift>;
  window: ScoreWindow;
  /** False when the shift data couldn't be had at all — every score is "—". */
  shiftsKnown?: boolean;
}): PersonScore[] {
  const credits = creditsByUser(input.pairs, input.window);
  const worked = shiftsWorkedByEmployee(input.shifts, input.window);
  const known = input.shiftsKnown !== false;
  return input.users.map(u => {
    const c = credits.get(u.userId) ?? { credits: 0, improvements: 0 };
    const shifts = known && u.plandayEmployeeId != null ? worked.get(u.plandayEmployeeId) ?? 0 : null;
    return {
      userId: u.userId,
      credits: c.credits,
      improvements: c.improvements,
      shifts,
      scorePct: shifts == null ? null : improvementScorePct(c.credits, shifts),
    };
  });
}

/**
 * Leaner-board order (Graeme, 2026-10-12: "the number of improvements ...
 * I wanted to be the main thing on the leaderboard. I want both"):
 *   1. most improvements in the last 30 days (the plain count, no ×2/×3);
 *   2. then the better score — anyone without one ("—") after everyone with;
 *   3. then the all-time count, then name.
 */
export function rankLeanerBoard<T extends { improvements30: number; scorePct: number | null; count: number; name: string }>(rows: ReadonlyArray<T>): T[] {
  return [...rows].sort((a, b) => {
    if (a.improvements30 !== b.improvements30) return b.improvements30 - a.improvements30;
    if (a.scorePct == null && b.scorePct != null) return 1;
    if (b.scorePct == null && a.scorePct != null) return -1;
    if (a.scorePct != null && b.scorePct != null && a.scorePct !== b.scorePct) return b.scorePct - a.scorePct;
    return b.count - a.count || a.name.localeCompare(b.name);
  });
}
