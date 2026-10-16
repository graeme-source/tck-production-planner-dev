import { describe, it, expect } from "vitest";
import {
  weekdayOf, addDays, earliestFromZapietCalendar, estimateLeadFromOrders,
  compareConversion, leadTimeFindings, weekdayProfile, changeImpact,
  describeLikelihood, usualLeadByWeekday, mulberry32, type DayFacts,
} from "./analysis";

describe("calendar helpers", () => {
  it("knows weekdays and adds days across month ends", () => {
    expect(weekdayOf("2026-10-16")).toBe(5); // Friday
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
});

describe("earliestFromZapietCalendar", () => {
  // Tue–Sat delivery: pickadate weekdays 1 = Sunday, 2 = Monday disabled.
  const tueToSat = [1, 2];

  it("next-day available on a normal Tuesday", () => {
    const a = earliestFromZapietCalendar("2026-10-13", { minDate: "2026-10-14", disabled: tueToSat });
    expect(a).toEqual({ earliestDate: "2026-10-14", leadDays: 1, nextDayAvailable: true });
  });

  it("Saturday's earliest is Tuesday (3 days) — structural, not 'next-day'", () => {
    const a = earliestFromZapietCalendar("2026-10-17", { minDate: "2026-10-18", disabled: tueToSat });
    expect(a.earliestDate).toBe("2026-10-20");
    expect(a.leadDays).toBe(3);
    expect(a.nextDayAvailable).toBe(false);
  });

  it("skips specific blocked dates ([year, monthIndex, day]) and honours a later minDate", () => {
    const a = earliestFromZapietCalendar("2026-10-16", {
      minDate: "2026-10-21T00:00:00Z",
      disabled: [...tueToSat, [2026, 9, 21], [2026, 9, 22]],
    });
    expect(a.earliestDate).toBe("2026-10-23");
    expect(a.leadDays).toBe(7);
  });

  it("returns nulls when nothing is bookable in the horizon", () => {
    const a = earliestFromZapietCalendar("2026-10-16", { disabled: [1, 2, 3, 4, 5, 6, 7] }, 10);
    expect(a).toEqual({ earliestDate: null, leadDays: null, nextDayAvailable: null });
  });
});

describe("estimateLeadFromOrders", () => {
  it("takes the shortest booked wait among orders before 1pm, ignoring weekday tags", () => {
    const est = estimateLeadFromOrders([
      { day: "2026-10-13", minuteOfDay: 9 * 60, tags: ["2026-10-17", "Saturday", "new-customer"] },
      { day: "2026-10-13", minuteOfDay: 11 * 60, tags: ["Wednesday", "2026-10-14"] },
      { day: "2026-10-13", minuteOfDay: 15 * 60, tags: ["2026-10-14"] }, // after 1pm: ignored
      { day: "2026-10-14", minuteOfDay: 10 * 60, tags: ["2026-10-21"] },
      { day: "2026-10-14", minuteOfDay: 10 * 60, tags: ["no-date"] },
    ]);
    expect(est).toEqual([
      { day: "2026-10-13", earliestDate: "2026-10-14", leadDays: 1, sampleOrders: 2 },
      { day: "2026-10-14", earliestDate: "2026-10-21", leadDays: 7, sampleOrders: 1 },
    ]);
  });
});

/** Ten weeks of synthetic days: base conversion per weekday, an optional
 *  penalty on "slow" days, and seeded noise. */
function synth(opts: { penalty: number; noise: number; seed?: number }): DayFacts[] {
  const rnd = mulberry32(opts.seed ?? 1);
  const base = [0.03, 0.045, 0.045, 0.045, 0.045, 0.04, 0.03];
  const usual = [2, 1, 1, 1, 1, 1, 3];
  const days: DayFacts[] = [];
  let day = "2026-07-05"; // a Sunday
  for (let i = 0; i < 70; i++) {
    const w = weekdayOf(day);
    const slow = i % 3 === 0; // a third of days have a long wait
    const lead = usual[w] + (slow ? 5 : 0);
    const rate = base[w] * (slow ? 1 - opts.penalty : 1) * (1 + (rnd() - 0.5) * opts.noise);
    const sessions = 1000;
    days.push({ day, sessions, orders: Math.round(rate * sessions), leadDays: lead });
    day = addDays(day, 1);
  }
  return days;
}

describe("compareConversion / leadTimeFindings", () => {
  it("finds a real 30% drop on slow days and is confident about it", () => {
    const days = synth({ penalty: 0.3, noise: 0.2 });
    const [anySlower, threePlus] = leadTimeFindings(days);
    expect(anySlower.comparison.enoughData).toBe(true);
    expect(anySlower.comparison.effect!).toBeLessThan(-0.2);
    expect(anySlower.comparison.effect!).toBeGreaterThan(-0.4);
    expect(anySlower.comparison.probabilityLower!).toBeGreaterThan(0.95);
    expect(threePlus.comparison.exposedDays).toBeGreaterThan(0);
  });

  it("is honestly calibrated: on pure noise it claims '95%+ sure' only ~10% of the time", () => {
    // Any single noisy dataset can land in the tail, so test the guarantee
    // that matters: across many noise-only datasets, confident-looking
    // answers are about as rare as they should be (5% each side).
    const runs = 150;
    let falseAlarms = 0;
    for (let s = 1; s <= runs; s++) {
      const c = compareConversion(synth({ penalty: 0, noise: 0.3, seed: s * 13 }), d => (d.leadDays ?? 0) >= 4, { iterations: 300 });
      expect(c.enoughData).toBe(true);
      if (c.probabilityLower! > 0.95 || c.probabilityLower! < 0.05) falseAlarms++;
    }
    expect(falseAlarms / runs).toBeGreaterThan(0.03);
    expect(falseAlarms / runs).toBeLessThan(0.18);
  });

  it("is deterministic for the same data", () => {
    const days = synth({ penalty: 0.2, noise: 0.2 });
    const a = compareConversion(days, d => (d.leadDays ?? 0) >= 4);
    const b = compareConversion(days, d => (d.leadDays ?? 0) >= 4);
    expect(a).toEqual(b);
  });

  it("says not enough data rather than guessing", () => {
    const days = synth({ penalty: 0.3, noise: 0.1 }).slice(0, 4);
    const c = compareConversion(days, d => (d.leadDays ?? 0) >= 4);
    expect(c.enoughData).toBe(false);
    expect(c.effect).toBeNull();
  });

  it("ignores days with too few sessions to mean anything", () => {
    const c = compareConversion(
      [{ day: "2026-10-13", sessions: 5, orders: 1, leadDays: 1 }],
      () => true,
    );
    expect(c.exposedDays).toBe(0);
  });
});

describe("usualLeadByWeekday / weekdayProfile", () => {
  it("learns the usual wait per weekday and profiles on usual-wait days only", () => {
    const days = synth({ penalty: 0.3, noise: 0 });
    const usual = usualLeadByWeekday(days);
    expect(usual[6]).toBe(3); // Saturday → Tuesday
    expect(usual[2]).toBe(1);
    const profile = weekdayProfile(days);
    const sat = profile.find(r => r.weekday === "Saturday")!;
    const wed = profile.find(r => r.weekday === "Wednesday")!;
    expect(sat.conversion!).toBeLessThan(wed.conversion!);
    expect(wed.conversion!).toBeCloseTo(0.045, 3); // slow days excluded
  });
});

describe("changeImpact", () => {
  it("compares the fortnight after a change with the fortnight before and reports a lead shift", () => {
    const days: DayFacts[] = [];
    let day = "2026-09-01";
    for (let i = 0; i < 40; i++) {
      const after = day > "2026-09-20";
      days.push({ day, sessions: 1000, orders: after ? 30 : 45, leadDays: after ? 6 : 1 });
      day = addDays(day, 1);
    }
    const r = changeImpact(days, "2026-09-20");
    expect(r.enoughData).toBe(true);
    expect(r.effect!).toBeCloseTo(-1 / 3, 2);
    expect(r.leadShift).toBe(5);
  });
});

describe("describeLikelihood", () => {
  it("words probabilities without certainty", () => {
    expect(describeLikelihood(0.97)).toBe("very likely lower");
    expect(describeLikelihood(0.85)).toBe("likely lower");
    expect(describeLikelihood(0.7)).toBe("possibly lower");
    expect(describeLikelihood(0.5)).toBe("no clear difference");
    expect(describeLikelihood(0.1)).toBe("likely higher");
    expect(describeLikelihood(null)).toBe("not enough data yet");
  });
});
