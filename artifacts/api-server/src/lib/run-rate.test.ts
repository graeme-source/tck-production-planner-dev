import { describe, it, expect } from "vitest";
import { computeBatchesPerHour, type StandardBreakConfig } from "./run-rate";

// September is BST: London = UTC+1.
const at = (hhmm: string, day = "2026-09-22") => new Date(`${day}T${hhmm}:00+01:00`);

/** A batch every `every` minutes from `from` up to (not past) `to`. */
function run(from: string, to: string, every = 3, day = "2026-09-22"): Date[] {
  const out: Date[] = [];
  const end = at(to, day).getTime();
  for (let t = at(from, day).getTime(); t < end; t += every * 60_000) out.push(new Date(t));
  out.push(new Date(end)); // always a batch exactly at `to`
  return out;
}

const CONFIG: StandardBreakConfig = {
  morning: { anchorMinutes: 9 * 60 + 15, minutes: 15 },
  lunch: { anchorMinutes: 12 * 60 + 15, minutes: 35 },
  allowanceMinutes: 7,
  lunchGapMinutes: 40,
};

describe("TCK run rate — breaks", () => {
  it("normal day (22 Sep shape): snack 22 + lunch 42 deducted", () => {
    // snack stop 09:06→09:35 (29 min), lunch stop 12:24→13:08 (44 min)
    const times = [...run("07:40", "09:06"), ...run("09:35", "12:24"), ...run("13:08", "13:38")];
    const r = computeBatchesPerHour(times, CONFIG);
    expect(r.morningBreakDeducted).toBe(true);
    expect(r.lunchBreakDeducted).toBe(true);
    expect(r.breakMinutesDeducted).toBe(22 + 42);
    expect(r.lunchDetectedAt?.toISOString()).toBe(at("12:24").toISOString());
  });

  it("finished before lunch (23 Sep shape): no lunch deducted", () => {
    const times = [...run("07:34", "09:10"), ...run("09:37", "12:02")];
    const r = computeBatchesPerHour(times, CONFIG);
    expect(r.lunchBreakDeducted).toBe(false);
    expect(r.breakMinutesDeducted).toBe(22);
  });

  it("built straight through to 12:45 with no lunch: nothing deducted for lunch (the reported bug)", () => {
    const times = [...run("07:40", "09:08"), ...run("09:36", "12:45"), ...run("12:46", "13:00")];
    const r = computeBatchesPerHour(times, CONFIG);
    expect(r.lunchBreakDeducted).toBe(false);
    expect(r.breakMinutesDeducted).toBe(22);
  });

  it("a long 34-minute morning snack is not mistaken for lunch (24 Aug shape)", () => {
    const times = [...run("07:42", "09:02"), ...run("09:36", "12:19")];
    const r = computeBatchesPerHour(times, CONFIG);
    expect(r.lunchBreakDeducted).toBe(false);
  });

  it("a late lunch is still found wherever it happens", () => {
    const times = [...run("07:40", "09:10"), ...run("09:38", "12:50"), ...run("13:40", "14:20")];
    const r = computeBatchesPerHour(times, CONFIG);
    expect(r.lunchDetectedAt?.toISOString()).toBe(at("12:50").toISOString());
    expect(r.breakMinutesDeducted).toBe(22 + 42);
  });

  it("never deducts more than the stop itself", () => {
    // 41-minute stop: lunch deduction capped at 41, not 42
    const times = [...run("07:40", "09:08"), ...run("09:36", "12:20"), ...run("13:01", "13:30")];
    expect(computeBatchesPerHour(times, CONFIG).breakMinutesDeducted).toBe(22 + 41);
  });

  it("a stop spanning the 09:15 snack is never lunch (21 Aug breakdown shape)", () => {
    const times = [...run("07:50", "07:59"), ...run("11:27", "11:44")];
    const r = computeBatchesPerHour(times, CONFIG);
    expect(r.lunchBreakDeducted).toBe(false);
  });

  it("a 'finished' press long after the last batch counts that stop as lunch", () => {
    const times = [...run("07:40", "09:06"), ...run("09:35", "12:10")];
    const r = computeBatchesPerHour(times, CONFIG, { finishedAt: at("13:05") });
    expect(r.lunchBreakDeducted).toBe(true);
    expect(r.breakMinutesDeducted).toBe(22 + 42);
  });

  it("the restart allowance comes from the setting", () => {
    const times = [...run("07:40", "09:06"), ...run("09:35", "12:24"), ...run("13:08", "13:38")];
    expect(computeBatchesPerHour(times, { ...CONFIG, allowanceMinutes: 0 }).breakMinutesDeducted).toBe(15 + 35);
  });
});

describe("TCK run rate — live view", () => {
  it("holds steady while paused at a break instead of sagging", () => {
    const times = run("07:40", "09:06");
    const before = computeBatchesPerHour(times, CONFIG, { liveNow: at("09:07") }).batchesPerHour;
    const midSnack = computeBatchesPerHour(times, CONFIG, { liveNow: at("09:30") }).batchesPerHour;
    expect(midSnack).toBe(computeBatchesPerHour(times, CONFIG).batchesPerHour);
    expect(before).not.toBeNull();
  });
  it("runs to now while building", () => {
    const times = run("07:40", "08:40");
    const r = computeBatchesPerHour(times, CONFIG, { liveNow: at("08:45") });
    expect(r.windowEndAt?.toISOString()).toBe(at("08:45").toISOString());
  });
});
