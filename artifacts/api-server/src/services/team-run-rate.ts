/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ THE ONLY PLACE THE TEAM TCK RUN RATE IS WORKED OUT.                   │
 * │                                                                      │
 * │ Any screen, meeting, report, AI answer or job that shows the team    │
 * │ run rate (calzone batches per hour) MUST get it from this file —     │
 * │ never select batch_completions and call computeBatchesPerHour        │
 * │ itself. That is how the building station and the end-of-day meeting │
 * │ came to show different numbers for the same day (28 Nov 2026).       │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * The rule (which batches, mac cheese, live vs finished, improvement
 * credit) is in lib/team-run-rate.ts; the maths is lib/run-rate.ts. This
 * file reads the rows, the break settings and the day's improvement credit,
 * and hands them over. Surfaces using it:
 *   - the building station's live number, and the dashboard / founder floor
 *     tiles that read it (GET /api/production-plans/:id/kpi)
 *   - Analytics → KPIs, each day and the range (GET /api/reports/production-kpis)
 *   - the through-the-day chart (GET /api/run-rate-day) — its last step and
 *     final value are this number
 *   - the morning meeting, its 7-day trend, and the end-of-day meeting
 *     (lib/yesterday-kpis → services/last-production-kpis, routes/end-of-day)
 *
 * Not this KPI, so not here: a builder's own "You" rate and Analytics' per
 * builder rows (each person's own batches, no credit), the performance
 * review's personal speed, and the wrapping pace.
 *
 * Read only. Objective G.
 */
import { db, batchCompletionsTable, productionPlanItemsTable, productionPlansTable, recipesTable, usersTable } from "@workspace/db";
import { and, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { getStandardBreakConfig } from "../lib/batches-per-hour";
import type { BphResult, StandardBreakConfig } from "../lib/run-rate";
import { londonDateString, londonDaysWindowUtc } from "../lib/london-time";
import {
  TEAM_RUN_RATE_STATIONS, isTeamRunRateLive, selectTeamRunRateDay, teamRunRateDates, teamRunRateFromSelection,
  type TeamRunRateRow, type TeamRunRateSelection,
} from "../lib/team-run-rate";
import { creditSummary, type CreditSummary, type DayCredit, type TeamCredit } from "../lib/improvement-kpi-credit";
import { loadImprovementKpiCredit, type ImprovementKpiCredit } from "./improvement-kpi-credit";

/** A counted completion, with what Analytics shows beside the number. */
export interface TeamRunRateCompletion extends TeamRunRateRow {
  userId: number | null;
  userName: string | null;
  recipeName: string;
  planName: string;
}

export interface TeamRunRateDay {
  date: string;
  /** THE number: batchesPerHour (with the improvement credit) and
   *  batchesPerHourBeforeCredit, plus the window and break detail. */
  result: BphResult;
  completions: TeamRunRateCompletion[];
  finishedAt: Date | null;
  /** Today and not marked finished: the window runs to now. */
  live: boolean;
  /** The moment the live window was measured to. */
  now: Date;
  /** The day's run-rate improvement credit (before the half-day cap). */
  credit: TeamCredit | undefined;
  creditSummary: CreditSummary;
  /** The break settings the number was worked out with. */
  breakConfig: StandardBreakConfig;
}

export interface TeamRunRateRange {
  days: Map<string, TeamRunRateDay>;
  breakConfig: StandardBreakConfig;
  credit: ImprovementKpiCredit;
  /** The whole range's per-day credit (for breakdowns of who wasn't counted). */
  creditDays: Map<string, DayCredit>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The completions that could count for London days from..to (the pure rule
 *  makes the final decision). */
async function loadRows(from: string, to: string): Promise<TeamRunRateCompletion[]> {
  const { start, end } = londonDaysWindowUtc(from, to);
  const rows = await db
    .select({
      completedAt: batchCompletionsTable.completedAt,
      stationType: batchCompletionsTable.stationType,
      userId: batchCompletionsTable.userId,
      userName: usersTable.name,
      planId: productionPlansTable.id,
      planDate: productionPlansTable.planDate,
      planName: productionPlansTable.name,
      buildingFinishedAt: productionPlansTable.buildingFinishedAt,
      recipeName: recipesTable.name,
      recipeCategory: recipesTable.category,
      excludeFromKpis: recipesTable.excludeFromKpis,
    })
    .from(batchCompletionsTable)
    .innerJoin(productionPlanItemsTable, eq(batchCompletionsTable.planItemId, productionPlanItemsTable.id))
    .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
    .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .leftJoin(usersTable, eq(batchCompletionsTable.userId, usersTable.id))
    .where(and(
      inArray(batchCompletionsTable.stationType, [...TEAM_RUN_RATE_STATIONS]),
      gte(productionPlansTable.planDate, from),
      lte(productionPlansTable.planDate, to),
      gte(batchCompletionsTable.completedAt, start),
      lt(batchCompletionsTable.completedAt, end),
    ));
  return rows.map(r => ({ ...r, planDate: String(r.planDate).slice(0, 10) }));
}

function dayFrom(
  sel: TeamRunRateSelection<TeamRunRateCompletion>,
  config: StandardBreakConfig,
  credit: ImprovementKpiCredit,
  now: Date,
): TeamRunRateDay {
  const dayCredit = credit.days.get(sel.date)?.runRate;
  const result = teamRunRateFromSelection(sel, config, now, dayCredit?.minutes ?? 0);
  return {
    date: sel.date,
    result,
    completions: sel.completions,
    finishedAt: sel.finishedAt,
    live: isTeamRunRateLive(sel.date, sel.finishedAt, now),
    now,
    credit: dayCredit,
    creditSummary: creditSummary(dayCredit, result.improvementMinutesCredited),
    breakConfig: config,
  };
}

/**
 * The run rate for each London day from..to (YYYY-MM-DD, inclusive). Only
 * days with a counted batch are in `days` unless `include` lists dates that
 * must be present (a day with no batches gets the empty result).
 */
export async function teamRunRateForRange(
  from: string,
  to: string,
  opts: { include?: readonly string[]; now?: Date } = {},
): Promise<TeamRunRateRange> {
  if (!DATE.test(from) || !DATE.test(to)) throw new Error(`teamRunRateForRange: dates must be YYYY-MM-DD (${from}, ${to})`);
  const now = opts.now ?? new Date();
  const [rows, breakConfig, credit] = await Promise.all([
    from <= to ? loadRows(from, to) : Promise.resolve([]),
    getStandardBreakConfig(),
    // Never throws: no credit (and the reason) if it can't be read.
    loadImprovementKpiCredit(from, to),
  ]);
  const dates = new Set(teamRunRateDates(rows));
  for (const d of opts.include ?? []) if (d >= from && d <= to) dates.add(d);
  const days = new Map<string, TeamRunRateDay>();
  for (const date of [...dates].sort()) {
    days.set(date, dayFrom(selectTeamRunRateDay(rows, date), breakConfig, credit, now));
  }
  return { days, breakConfig, credit, creditDays: credit.days };
}

/** The run rate for the listed London days (missing days get the empty result). */
export async function teamRunRateForDates(dates: readonly string[], opts: { now?: Date } = {}): Promise<Map<string, TeamRunRateDay>> {
  if (dates.length === 0) return new Map();
  const sorted = [...dates].sort();
  const range = await teamRunRateForRange(sorted[0]!, sorted[sorted.length - 1]!, { include: dates, now: opts.now });
  return new Map(dates.map(d => [d, range.days.get(d)!]));
}

/** The run rate for one London day. */
export async function teamRunRateForDate(date: string, opts: { now?: Date } = {}): Promise<TeamRunRateDay> {
  return (await teamRunRateForDates([date], opts)).get(date)!;
}

/** The run rate for the day a plan is dated — what the building station shows. */
export async function teamRunRateForPlan(planId: number, opts: { now?: Date } = {}): Promise<TeamRunRateDay> {
  const [plan] = await db.select({ planDate: productionPlansTable.planDate })
    .from(productionPlansTable).where(eq(productionPlansTable.id, planId)).limit(1);
  const date = plan ? String(plan.planDate).slice(0, 10) : londonDateString(opts.now ?? new Date());
  return teamRunRateForDate(date, opts);
}

/** A query's from/to as a London date: YYYY-MM-DD as given, else the London day of the instant. */
export function asLondonDate(v: unknown, fallback: string): string {
  if (v == null || v === "") return fallback;
  const s = String(v);
  if (DATE.test(s.slice(0, 10)) && s.length <= 10) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? fallback : londonDateString(d);
}
