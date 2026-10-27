import { describe, it, expect } from "vitest";
import {
  learnMeatTiming, runLeadMinutes, isRealTray, percentile, configuredLead,
  LEARNING_RULES, type MeatRun,
} from "./meat-timing-learning";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 1, 6, 0);

/** A run whose first real tray goes in at T0 and cooks `cook` minutes; the first tin is mixed `lead` minutes after T0. */
function run(day: number, lead: number, cook = 25, extraTrays: MeatRun["trays"] = []): MeatRun {
  return {
    planId: day,
    recipeId: 1,
    planDate: `2026-10-${String(day).padStart(2, "0")}`,
    trays: [{ inAtMs: T0, outAtMs: T0 + cook * MIN }, ...extraTrays],
    fillingReadyAtMs: T0 + lead * MIN,
  };
}

const chicken = { cookMinutes: 25, processMinutes: 15, graceMinutes: null };

describe("percentile", () => {
  it("interpolates", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.9)).toBeCloseTo(91);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("isRealTray — tap-throughs and trays left open", () => {
  it("drops a tray tapped in and out together", () => {
    expect(isRealTray({ inAtMs: T0, outAtMs: T0 + 1 * MIN }, 25)).toBe(false);
    expect(isRealTray({ inAtMs: T0, outAtMs: T0 + 12 * MIN }, 25)).toBe(false); // under half the cook
    expect(isRealTray({ inAtMs: T0, outAtMs: T0 + 13 * MIN }, 25)).toBe(true);
  });
  it("drops a tray left open all day", () => {
    expect(isRealTray({ inAtMs: T0, outAtMs: T0 + 150 * MIN }, 25)).toBe(false);
    expect(isRealTray({ inAtMs: T0, outAtMs: T0 + 140 * MIN }, 25)).toBe(true);
    expect(isRealTray({ inAtMs: T0, outAtMs: null }, 25)).toBe(false);
  });
});

describe("runLeadMinutes", () => {
  it("measures first REAL tray in → first tin mixed", () => {
    // A tap-through tray went in earlier; it must not stretch the lead.
    const r = run(1, 40, 25, [{ inAtMs: T0 - 30 * MIN, outAtMs: T0 - 29 * MIN }]);
    expect(runLeadMinutes(r, 25)).toEqual({ lead: 40 });
  });
  it("says why a run can't be trusted", () => {
    expect(runLeadMinutes({ ...run(1, 40), trays: [] }, 25)).toEqual({ drop: "no_real_tray" });
    expect(runLeadMinutes({ ...run(1, 40), fillingReadyAtMs: null }, 25)).toEqual({ drop: "no_filling_tick" });
    expect(runLeadMinutes(run(1, 10), 25)).toEqual({ drop: "filling_before_cooked" });
    expect(runLeadMinutes(run(1, 25 + 181), 25)).toEqual({ drop: "too_long" });
  });
});

describe("learnMeatTiming", () => {
  it("no data → configured values stand, nothing changes", () => {
    const l = learnMeatTiming([], chicken);
    expect(l.status).toBe("not_enough_data");
    expect(l.changes).toEqual([]);
    expect(l.proposed).toBeNull();
    expect(l.configuredLeadMinutes).toBe(40);
  });

  it("too little data (under 5 clean runs) → no change", () => {
    const l = learnMeatTiming([run(1, 50), run(2, 52), run(3, 51), run(4, 49)], chicken);
    expect(l.status).toBe("not_enough_data");
    expect(l.runsUsed).toBe(4);
    expect(l.changes).toEqual([]);
  });

  it("no cook time → never guesses (cook time is a food-safety value)", () => {
    const l = learnMeatTiming([1, 2, 3, 4, 5, 6].map(d => run(d, 50)), { cookMinutes: null, processMinutes: 10, graceMinutes: null });
    expect(l.status).toBe("no_cook_time");
    expect(l.changes).toEqual([]);
  });

  it("learns processing from the median and grace from the slow end", () => {
    // Leads 38..47: median 42.5 → process round(17.5) = 18; p90 46.1 → grace ≈ 4 → floor 5.
    const runs = [38, 39, 40, 41, 42, 43, 44, 45, 46, 47].map((lead, i) => run(i + 1, lead));
    const l = learnMeatTiming(runs, chicken);
    expect(l.status).toBe("learned");
    expect(l.runsUsed).toBe(10);
    expect(l.learned).toEqual({ processMinutes: 18, graceMinutes: 5 });
    expect(l.proposed).toEqual({ processMinutes: 18, graceMinutes: 5 });
    expect(l.changes.map(c => [c.field, c.from, c.to])).toEqual([["process", 15, 18], ["grace", null, 5]]);
    expect(l.changes[0].reason).toMatch(/Last 10 runs/);
  });

  it("one odd day can't swing it (outlier dropped)", () => {
    const runs = [40, 41, 40, 42, 41, 40, 41].map((lead, i) => run(i + 1, lead));
    runs.push(run(20, 190)); // a breakdown day — the newest run
    const l = learnMeatTiming(runs, chicken);
    expect(l.dropped.outlier).toBe(1);
    expect(l.lead!.max).toBe(42);
    expect(l.learned!.processMinutes).toBe(16);
  });

  it("small differences are noise — no change", () => {
    const runs = [39, 40, 41, 40, 39, 41, 40].map((lead, i) => run(i + 1, lead));
    const l = learnMeatTiming(runs, { cookMinutes: 25, processMinutes: 14, graceMinutes: 5 });
    expect(l.learned!.processMinutes).toBe(15);
    expect(l.changes).toEqual([]);
  });

  it("moves at most 15 min per run towards a big difference", () => {
    // Pork: cook 180, process 60 configured; the floor takes ~190 to the first tin.
    const runs = [186, 188, 190, 192, 194, 189, 191].map((lead, i) => run(i + 1, lead, 180));
    const l = learnMeatTiming(runs, { cookMinutes: 180, processMinutes: 60, graceMinutes: null });
    expect(l.learned!.processMinutes).toBe(10);
    expect(l.proposed!.processMinutes).toBe(45);
    expect(l.changes[0].reason).toMatch(/moving 15 min at a time towards 10/);
  });

  it("grace never goes above the cap, whatever the spread", () => {
    const runs = [40, 45, 50, 55, 60, 70, 80, 90, 100, 110].map((lead, i) => run(i + 1, lead));
    const l = learnMeatTiming(runs, { ...chicken, graceMinutes: 25 });
    expect(l.learned!.graceMinutes).toBe(LEARNING_RULES.graceMax);
    expect(l.proposed!.graceMinutes).toBeLessThanOrEqual(LEARNING_RULES.graceMax);
  });

  it("never proposes a lead shorter than the cook time", () => {
    // Filling ticked at exactly the cook time every day: process 0, never negative.
    const runs = [25, 25, 25, 25, 25, 25].map((lead, i) => run(i + 1, lead));
    const l = learnMeatTiming(runs, chicken);
    expect(l.learned!.processMinutes).toBe(0);
    expect(l.proposed!.processMinutes).toBe(0);
    const total = 25 + l.proposed!.processMinutes + l.proposed!.graceMinutes;
    expect(total).toBeGreaterThanOrEqual(25);
  });

  it("uses only the newest runs in the window", () => {
    const old = Array.from({ length: 20 }, (_, i) => ({ ...run(i + 1, 60), planDate: `2026-08-${String(i + 1).padStart(2, "0")}` }));
    const recent = Array.from({ length: 20 }, (_, i) => run(i + 1, 40));
    const l = learnMeatTiming([...old, ...recent], chicken);
    expect(l.runsUsed).toBe(20);
    expect(l.lead!.median).toBe(40);
  });
});

describe("configuredLead", () => {
  it("adds cook + process + grace, grace unset = 0", () => {
    expect(configuredLead({ cookMinutes: 25, processMinutes: 15, graceMinutes: null })).toBe(40);
    expect(configuredLead({ cookMinutes: 25, processMinutes: 15, graceMinutes: 10 })).toBe(50);
    expect(configuredLead({ cookMinutes: null, processMinutes: null, graceMinutes: 10 })).toBeNull();
  });
});
