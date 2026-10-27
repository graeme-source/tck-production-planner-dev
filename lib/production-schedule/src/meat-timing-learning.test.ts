import { describe, it, expect } from "vitest";
import {
  learnMeatTiming, runProcessMinutes, trayCookedAtMs, percentile, weightedPercentile, configuredLead,
  LEARNING_RULES, type MeatRun,
} from "./meat-timing-learning";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 1, 6, 0);

/**
 * A run: one tray in at T0, out after `cook` min; the first tin mixed
 * `process` min after it came out. `needError` = predicted − actual need.
 */
function run(day: number, process: number, opts: { cook?: number; needError?: number | null; probeLag?: number | null; extraTrays?: MeatRun["trays"] } = {}): MeatRun {
  const cook = opts.cook ?? 25;
  const out = T0 + cook * MIN;
  return {
    planId: day,
    recipeId: 1,
    planDate: `2026-10-${String(day).padStart(2, "0")}`,
    trays: [{ inAtMs: T0, outAtMs: out, probeAtMs: opts.probeLag == null ? null : out + opts.probeLag * MIN }, ...(opts.extraTrays ?? [])],
    fillingReadyAtMs: out + process * MIN,
    needErrorMinutes: opts.needError ?? null,
  };
}

const chicken = { cookMinutes: 25, processMinutes: 10, bufferMinutes: null };

describe("percentiles", () => {
  it("interpolate; equal weights match the plain percentile", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    const v = [3, 9, 1, 7, 5];
    expect(weightedPercentile(v.map(value => ({ value, weight: 1 })), 0.5)).toBe(5);
  });
});

describe("trayCookedAtMs — prefer the probe, distrust tap-throughs", () => {
  it("the probe reading wins over the out tap", () => {
    expect(trayCookedAtMs({ inAtMs: T0, outAtMs: T0 + 60 * MIN, probeAtMs: T0 + 27 * MIN }, 25)).toBe(T0 + 27 * MIN);
  });
  it("with a probe, even a tap-through tray has a good cooked time", () => {
    expect(trayCookedAtMs({ inAtMs: T0, outAtMs: T0 + 1 * MIN, probeAtMs: T0 + 2 * MIN }, 25)).toBe(T0 + 2 * MIN);
  });
  it("without a probe, a tap-through or a tray left open is ignored", () => {
    expect(trayCookedAtMs({ inAtMs: T0, outAtMs: T0 + 1 * MIN }, 25)).toBeNull();
    expect(trayCookedAtMs({ inAtMs: T0, outAtMs: T0 + 150 * MIN }, 25)).toBeNull();
    expect(trayCookedAtMs({ inAtMs: T0, outAtMs: T0 + 26 * MIN }, 25)).toBe(T0 + 26 * MIN);
  });
});

describe("runProcessMinutes — out of the oven → first tin mixed", () => {
  it("uses the latest tray out BEFORE the tin (trays still cooking weren't in it)", () => {
    const r = run(1, 12, { extraTrays: [{ inAtMs: T0 + 10 * MIN, outAtMs: T0 + 80 * MIN }] });
    expect(runProcessMinutes(r, 25)).toEqual({ process: 12 });
  });
  it("prefers the probe time", () => {
    expect(runProcessMinutes(run(1, 12, { probeLag: 2 }), 25)).toEqual({ process: 10 });
  });
  it("says why a run can't be used", () => {
    expect(runProcessMinutes({ ...run(1, 12), trays: [{ inAtMs: T0, outAtMs: T0 + MIN }] }, 25)).toEqual({ drop: "no_cooked_time" });
    expect(runProcessMinutes({ ...run(1, 12), fillingReadyAtMs: null }, 25)).toEqual({ drop: "no_filling_tick" });
    expect(runProcessMinutes(run(1, -5), 25)).toEqual({ drop: "filling_before_cooked" });
    expect(runProcessMinutes(run(1, 250), 25)).toEqual({ drop: "too_long" });
  });
});

describe("learnMeatTiming — processing and buffer, per meat", () => {
  it("no data → the set times stand", () => {
    const l = learnMeatTiming([], chicken);
    expect(l.status).toBe("not_enough_data");
    expect(l.changes).toEqual([]);
    expect(l.configuredLeadMinutes).toBe(25 + 10 + 5);
  });

  it("no cook time → never guesses (cook time is a food-safety value)", () => {
    const l = learnMeatTiming([1, 2, 3, 4].map(d => run(d, 10)), { cookMinutes: null, processMinutes: 10, bufferMinutes: null });
    expect(l.status).toBe("no_cook_time");
    expect(l.changes).toEqual([]);
  });

  it("little data: learns processing but starts the buffer small (5)", () => {
    const l = learnMeatTiming([run(1, 20), run(2, 21), run(3, 19)], { cookMinutes: 25, processMinutes: null, bufferMinutes: null });
    expect(l.status).toBe("learned");
    expect(l.learned!.processMinutes).toBe(20);
    expect(l.learned!.bufferMinutes).toBe(LEARNING_RULES.bufferStart);
  });

  it("sat-for-ages days: 'only takes 20 min to process' → processing 20, not the hour it sat", () => {
    // Mostly 20 min; some days the tin was ticked much later (it sat).
    const runs = [20, 21, 19, 60, 20, 22, 55, 20, 21, 19].map((p, i) => run(i + 1, p));
    const l = learnMeatTiming(runs, { cookMinutes: 25, processMinutes: 60, bufferMinutes: 10 });
    expect(l.learned!.processMinutes).toBeLessThanOrEqual(21);
    expect(l.changes.find(c => c.field === "process")!.to).toBe(45); // 60 → 45, 15 min a run
  });

  it("buffer = the smallest cover that keeps waits rare (80th percentile with waits 4× sitting)", () => {
    // Steady processing; the builders came 0-12 min earlier than predicted.
    const errs = [0, 2, 1, 12, 3, 0, 4, 2, 10, 1];
    const runs = errs.map((e, i) => run(i + 1, 15, { needError: e }));
    const l = learnMeatTiming(runs, { cookMinutes: 25, processMinutes: 15, bufferMinutes: null });
    expect(l.needErrorRuns).toBe(10);
    expect(l.learned!.processMinutes).toBe(15);
    expect(l.learned!.bufferMinutes).toBeGreaterThanOrEqual(3);
    expect(l.learned!.bufferMinutes).toBeLessThanOrEqual(10);
  });

  it("predictable days need hardly any buffer (floor 2)", () => {
    const runs = Array.from({ length: 10 }, (_, i) => run(i + 1, 15, { needError: 0 }));
    expect(learnMeatTiming(runs, { cookMinutes: 25, processMinutes: 15, bufferMinutes: null }).learned!.bufferMinutes).toBe(LEARNING_RULES.bufferMin);
  });

  it("the buffer is capped however wild the days", () => {
    const runs = Array.from({ length: 10 }, (_, i) => run(i + 1, 15, { needError: 60 }));
    expect(learnMeatTiming(runs, { cookMinutes: 25, processMinutes: 15, bufferMinutes: null }).learned!.bufferMinutes).toBe(LEARNING_RULES.bufferMax);
  });

  it("one odd day can't swing it (outlier dropped)", () => {
    const runs = [20, 21, 20, 22, 21, 20, 21].map((p, i) => run(i + 1, p));
    runs.push(run(20, 200));
    const l = learnMeatTiming(runs, chicken);
    expect(l.dropped.outlier).toBe(1);
    expect(l.processing!.max).toBe(22);
  });

  it("recent days count more, so a change in pace is followed", () => {
    const runs = [
      ...Array.from({ length: 10 }, (_, i) => run(i + 1, 10)),
      ...Array.from({ length: 5 }, (_, i) => run(i + 11, 25)),
    ];
    const l = learnMeatTiming(runs, chicken, { ...LEARNING_RULES, outlierMads: 100 });
    expect(l.processing!.median).toBeGreaterThan(15);
  });

  it("moves at most a step per run; half steps with little data", () => {
    const runs = [50, 51, 49, 50, 52, 50, 51].map((p, i) => run(i + 1, p));
    const l = learnMeatTiming(runs, { cookMinutes: 25, processMinutes: 10, bufferMinutes: 5 });
    expect(l.proposed!.processMinutes).toBe(17); // 7 runs → 7-min steps
    expect(l.changes[0].reason).toMatch(/moving 7 min at a time/);
  });

  it("small differences are noise — no change", () => {
    const runs = [15, 15, 16, 15, 14, 15, 15, 16].map((p, i) => run(i + 1, p, { needError: 0 }));
    const l = learnMeatTiming(runs, { cookMinutes: 25, processMinutes: 15, bufferMinutes: 2 });
    expect(l.changes).toEqual([]);
  });

  it("runs the review excludes (time not followed) don't move it", () => {
    const runs = [20, 21, 20, 22, 21].map((p, i) => run(i + 1, p));
    runs.push(run(10, 70), run(11, 72), run(12, 71));
    const l = learnMeatTiming(runs, chicken, LEARNING_RULES, new Set(["10:1", "11:1", "12:1"]));
    expect(l.dropped.not_followed).toBe(3);
    expect(l.processing!.max).toBe(22);
  });

  it("never touches the cook time: the lead is always ≥ cook", () => {
    const runs = [0, 0, 0, 0, 0].map((p, i) => run(i + 1, p));
    const l = learnMeatTiming(runs, chicken);
    expect(l.proposed!.processMinutes).toBeGreaterThanOrEqual(0);
    expect(configuredLead({ cookMinutes: 25, ...l.proposed!, bufferMinutes: l.proposed!.bufferMinutes })!).toBeGreaterThanOrEqual(25);
    expect(l.changes.every(c => c.field !== ("cook" as string))).toBe(true);
  });
});
