import { describe, it, expect } from "vitest";
import { computeBatchesPerHour, type StandardBreakConfig } from "./run-rate";
import { runRateThroughDay } from "./run-rate-through-day";
import {
  countsForTeamRunRate, isTeamRunRateLive, selectTeamRunRateDay, teamRunRateDates, teamRunRateFromSelection, teamRunRateOptions,
  type TeamRunRateRow,
} from "./team-run-rate";

const config: StandardBreakConfig = {
  morning: { anchorMinutes: 9 * 60 + 15, minutes: 15 },
  lunch: { anchorMinutes: 12 * 60 + 15, minutes: 35 },
  allowanceMinutes: 7,
  lunchGapMinutes: 40,
};

// 25 Nov 2026 is GMT, so London clock = UTC.
const DAY = "2026-11-25";
const at = (hhmm: string, date = DAY) => new Date(`${date}T${hhmm}:00Z`);
const row = (hhmm: string, over: Partial<TeamRunRateRow> = {}): TeamRunRateRow => ({
  completedAt: at(hhmm),
  stationType: "building_1",
  planId: 1,
  planDate: DAY,
  buildingFinishedAt: null,
  recipeCategory: "Calzones",
  excludeFromKpis: false,
  ...over,
});
function every(from: string, to: string, minutes: number, over: Partial<TeamRunRateRow> = {}): TeamRunRateRow[] {
  const out: TeamRunRateRow[] = [];
  for (let t = at(from).getTime(); t <= at(to).getTime(); t += minutes * 60_000) {
    out.push({ ...row("00:00", over), completedAt: new Date(t) });
  }
  return out;
}
const BUILT = [...every("08:03", "09:15", 3), ...every("09:40", "12:00", 3), ...every("12:51", "13:30", 3)];
const AFTER = at("08:00", "2026-11-26"); // the next morning: a past day

describe("which batches count for the team run rate", () => {
  it("counts calzone building completions on the plan's own day", () => {
    expect(countsForTeamRunRate(row("10:00"), DAY)).toBe(true);
    expect(countsForTeamRunRate(row("10:00", { stationType: "building_2" }), DAY)).toBe(true);
    expect(countsForTeamRunRate(row("10:00", { recipeCategory: null }), DAY)).toBe(true);
  });

  it("leaves out mac cheese, fried chicken, KPI-excluded recipes and other stations", () => {
    expect(countsForTeamRunRate(row("10:00", { recipeCategory: "Macaroni Cheese" }), DAY)).toBe(false);
    expect(countsForTeamRunRate(row("10:00", { recipeCategory: "Fried Chicken" }), DAY)).toBe(false);
    expect(countsForTeamRunRate(row("10:00", { excludeFromKpis: true }), DAY)).toBe(false);
    expect(countsForTeamRunRate(row("10:00", { stationType: "wrapping" }), DAY)).toBe(false);
  });

  it("leaves out ticks on another plan's day or tapped on another day", () => {
    expect(countsForTeamRunRate(row("10:00", { planDate: "2026-11-24" }), DAY)).toBe(false);
    // Catch-up tap the next morning for yesterday's plan.
    expect(countsForTeamRunRate({ ...row("09:30"), completedAt: at("09:30", "2026-11-26") }, DAY)).toBe(false);
    expect(countsForTeamRunRate({ ...row("09:30"), completedAt: at("09:30", "2026-11-26") }, "2026-11-26")).toBe(false);
  });

  it("uses the London day, not UTC (BST)", () => {
    // 23:30 UTC on 1 Jul is 00:30 London on 2 Jul.
    const r = { ...row("10:00", { planDate: "2026-07-02" }), completedAt: new Date("2026-07-01T23:30:00Z") };
    expect(countsForTeamRunRate(r, "2026-07-02")).toBe(true);
  });

  it("lists only days with a counted batch", () => {
    expect(teamRunRateDates([row("10:00"), row("10:00", { planDate: "2026-11-24", recipeCategory: "Macaroni Cheese" })])).toEqual([DAY]);
  });

  it("takes the latest finish press among the day's plans with counted batches", () => {
    const sel = selectTeamRunRateDay([
      row("09:00", { planId: 1, buildingFinishedAt: at("12:00") }),
      row("10:00", { planId: 2, buildingFinishedAt: at("13:00") }),
      row("10:00", { planId: 3, buildingFinishedAt: at("15:00"), recipeCategory: "Macaroni Cheese" }),
    ], DAY);
    expect(sel.finishedAt).toEqual(at("13:00"));
    expect(sel.completions).toHaveLength(2);
  });
});

describe("live or finished", () => {
  it("is live only today with no finish press", () => {
    expect(isTeamRunRateLive(DAY, null, at("11:00"))).toBe(true);
    expect(isTeamRunRateLive(DAY, at("10:00"), at("11:00"))).toBe(false);
    expect(isTeamRunRateLive(DAY, null, at("08:00", "2026-11-26"))).toBe(false);
  });

  it("live: the window runs to now; past days stop at the last batch", () => {
    const sel = selectTeamRunRateDay(every("08:00", "10:00", 3), DAY);
    const live = teamRunRateFromSelection(sel, config, at("10:05"), 0);
    const past = teamRunRateFromSelection(sel, config, AFTER, 0);
    expect(live.windowEndAt).toEqual(at("10:05"));
    expect(past.windowEndAt).toEqual(at("10:00"));
  });
});

// The number Graeme asked for (28 Nov 2026): the station, Analytics, the
// meetings and the day chart are fed the same selection and options, so they
// must give the same number — live, finished, and with improvement credit.
describe("same inputs, same number on every surface", () => {
  const credits = [{ at: at("10:30").toISOString(), minutes: 20 }, { at: at("14:30").toISOString(), minutes: 10 }];
  const cases: Array<{ name: string; rows: TeamRunRateRow[]; now: Date }> = [
    { name: "finished day with a press", rows: BUILT.map(r => ({ ...r, buildingFinishedAt: at("13:40") })), now: AFTER },
    { name: "past day nobody marked finished (credit logged after the last batch)", rows: BUILT, now: AFTER },
    { name: "live, mid-morning", rows: BUILT.filter(r => r.completedAt <= at("11:00")), now: at("11:02") },
    { name: "live, paused at lunch", rows: BUILT.filter(r => r.completedAt <= at("12:00")), now: at("12:30") },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const sel = selectTeamRunRateDay(c.rows, DAY);
      const minutesNow = credits.filter(e => new Date(e.at) <= c.now).reduce((n, e) => n + e.minutes, 0);
      const team = teamRunRateFromSelection(sel, config, c.now, minutesNow);
      // Any surface calling the maths directly with the shared options:
      const direct = computeBatchesPerHour(sel.completions.map(r => r.completedAt), config, teamRunRateOptions(sel, c.now, minutesNow));
      expect(direct.batchesPerHour).toBe(team.batchesPerHour);
      // The day chart, given the same selection: its final and last step land on it.
      const live = isTeamRunRateLive(DAY, sel.finishedAt, c.now);
      const chart = runRateThroughDay(sel.completions.map(r => r.completedAt), config, {
        finishedAt: sel.finishedAt,
        now: live ? c.now : null,
        improvementCredits: credits.filter(e => new Date(e.at) <= c.now),
      });
      expect(chart.final).toBe(team.batchesPerHour);
      expect(chart.steps[chart.steps.length - 1]!.runRate).toBe(team.batchesPerHour);
      expect(chart.finalBeforeCredit).toBe(team.batchesPerHourBeforeCredit);
      expect(team.batchesPerHour).not.toBeNull();
    });
  }
});
