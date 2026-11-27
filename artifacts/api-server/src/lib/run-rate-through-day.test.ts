import { describe, it, expect } from "vitest";
import { computeBatchesPerHour, type StandardBreakConfig } from "./run-rate";
import { runRateThroughDay } from "./run-rate-through-day";

const config: StandardBreakConfig = {
  morning: { anchorMinutes: 9 * 60 + 15, minutes: 15 },
  lunch: { anchorMinutes: 12 * 60 + 15, minutes: 35 },
  allowanceMinutes: 7,
  lunchGapMinutes: 40,
};

// 25 Nov 2026 is GMT, so London clock = UTC.
const at = (hhmm: string) => new Date(`2026-11-25T${hhmm}:00Z`);
function every(from: string, to: string, minutes: number): Date[] {
  const out: Date[] = [];
  for (let t = at(from).getTime(); t <= at(to).getTime(); t += minutes * 60_000) out.push(new Date(t));
  return out;
}

// A batch every 3 minutes, snack 09:15–09:40, lunch 11:58–12:51.
const DAY = [...every("08:03", "09:15", 3), ...every("09:40", "12:00", 3), ...every("12:51", "14:00", 3)];

describe("run rate through the day", () => {
  it("steps every 15 minutes with the batches built in each", () => {
    const d = runRateThroughDay(DAY, config);
    expect(d.steps[0].label).toBe("08:00");
    expect(d.steps.map(s => s.label).slice(0, 5)).toEqual(["08:00", "08:15", "08:30", "08:45", "09:00"]);
    expect(d.steps[1].batches).toBe(5);
    expect(d.steps.reduce((n, s) => n + s.batches, 0)).toBe(DAY.length);
    expect(d.steps[d.steps.length - 1].batchesSoFar).toBe(DAY.length);
  });

  it("ends on the day's own number, and shows lunch as a stop with the number held", () => {
    const d = runRateThroughDay(DAY, config);
    const whole = computeBatchesPerHour(DAY, config);
    expect(d.final).toBe(whole.batchesPerHour);
    expect(d.steps[d.steps.length - 1].runRate).toBe(whole.batchesPerHour);
    const lunchSteps = d.steps.filter(s => s.label === "12:15" || s.label === "12:30");
    expect(lunchSteps.every(s => s.batches === 0 && s.held)).toBe(true);
    // Held means unchanged through the stop.
    expect(new Set(lunchSteps.map(s => s.runRate)).size).toBe(1);
    expect(d.lunch?.fromMinute).toBe(11 * 60 + 58);
    expect(Math.round(d.lunch!.toMinute)).toBe(12 * 60 + 51);
    expect(d.snack).toEqual({ fromMinute: 555, toMinute: 570 });
  });

  it("uses the finished rule once building is marked finished", () => {
    const d = runRateThroughDay(DAY, config, { finishedAt: at("14:05") });
    expect(d.finished).toBe(true);
    expect(d.final).toBe(computeBatchesPerHour(DAY, config, { finishedAt: at("14:05") }).batchesPerHour);
    expect(d.steps[d.steps.length - 1].runRate).toBe(d.final);
  });

  it("today runs to now", () => {
    const morning = every("08:03", "09:00", 3);
    const d = runRateThroughDay(morning, config, { now: at("09:10") });
    expect(d.steps.map(s => s.label)).toEqual(["08:00", "08:15", "08:30", "08:45", "09:00"]);
    expect(d.final).toBe(computeBatchesPerHour(morning, config, { liveNow: at("09:10") }).batchesPerHour);
  });

  it("no batches, no steps", () => {
    expect(runRateThroughDay([], config).steps).toEqual([]);
  });

  it("improvement time: each step takes off what was done by then; the final number takes off the day's", () => {
    const credits = [{ at: at("10:00").toISOString(), minutes: 10 }, { at: at("13:00").toISOString(), minutes: 20 }];
    const d = runRateThroughDay(DAY, config, { improvementCredits: credits });
    const plain = runRateThroughDay(DAY, config);
    expect(d.final).toBe(computeBatchesPerHour(DAY, config, { improvementMinutes: 30 }).batchesPerHour);
    expect(d.finalBeforeCredit).toBe(plain.final);
    expect(d.improvementMinutesCredited).toBe(30);
    expect(d.batches).toBe(plain.batches);
    const step = (label: string, day: typeof d) => day.steps.find(s => s.label === label)!;
    expect(step("08:30", d).runRate).toBe(step("08:30", plain).runRate); // nothing done yet
    expect(step("10:30", d).runRate!).toBeGreaterThan(step("10:30", plain).runRate!);
  });
});
