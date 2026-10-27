import { describe, expect, it } from "vitest";
import { addDaysIso, estimateSsp, linkedRunStart, sspWeeklyRate, type SspPersonInput } from "./ssp";

/** Pay of `perDay` on each weekday (Mon–Fri) from `from` to `to`. */
function weekdayPay(from: string, to: string, perDay: number) {
  const out: Array<{ date: string; pay: number }> = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow >= 1 && dow <= 5) out.push({ date: d, pay: perDay });
  }
  return out;
}

const base = (over: Partial<SspPersonInput> = {}): SspPersonInput => ({
  sickDates: [],
  earlierSickDates: [],
  lookbackFrom: "2026-03-29",
  // £100 a day, five days a week: AWE £500, well above the flat rate.
  pay: weekdayPay("2026-07-01", "2026-10-24", 100),
  contractDaysPerWeek: 5,
  ...over,
});

describe("SSP estimate (rules from 6 April 2026)", () => {
  it("the flat rate is £123.25 a week from 6 April 2026, none before", () => {
    expect(sspWeeklyRate("2026-04-06")).toBe(123.25);
    expect(sspWeeklyRate("2026-10-01")).toBe(123.25);
    expect(sspWeeklyRate("2026-04-05")).toBeNull();
  });

  it("pays from the first day — one day off is enough — at the flat rate ÷ qualifying days", () => {
    const e = estimateSsp(base({ sickDates: ["2026-10-07"] }));
    expect(e.days).toEqual([{ date: "2026-10-07", amount: 24.65 }]);
    expect(e.total).toBe(24.65);
    expect(e.weeklySsp).toBe(123.25);
    expect(e.awe).toBe(500);
    expect(e.qualifyingDaysPerWeek).toBe(5);
    expect(e.notes).toEqual([]);
  });

  it("low earners get 80% of average weekly earnings (no lower earnings limit)", () => {
    // £25 a day × 3 days = £75 a week → 80% = £60 a week, ÷ 3 days.
    const pay = weekdayPay("2026-07-01", "2026-10-24", 25).filter(x => [1, 3, 5].includes(new Date(`${x.date}T00:00:00Z`).getUTCDay()));
    const e = estimateSsp(base({ pay, contractDaysPerWeek: 3, sickDates: ["2026-10-07"] }));
    expect(e.awe).toBe(75);
    expect(e.weeklySsp).toBe(60);
    expect(e.days[0].amount).toBe(20);
  });

  it("uses days worked a week when the contract doesn't say", () => {
    const pay = weekdayPay("2026-07-01", "2026-10-24", 100).filter(x => new Date(`${x.date}T00:00:00Z`).getUTCDay() <= 4);
    const e = estimateSsp(base({ pay, contractDaysPerWeek: null, sickDates: ["2026-10-07"] }));
    expect(e.qualifyingDaysPerWeek).toBe(4);
    expect(e.days[0].amount).toBe(30.81);
  });

  it("never pays more qualifying days in a week than the person works", () => {
    // Sick all seven days of one week, 5-day contract: five days paid.
    const week = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"];
    const e = estimateSsp(base({ sickDates: week }));
    expect(e.days.filter(d => (d.amount ?? 0) > 0)).toHaveLength(5);
    expect(e.total).toBe(123.25);
  });

  it("a newer starter is averaged over the weeks they've worked", () => {
    // Started 2 weeks before going sick: £1,000 over 2 weeks = £500 a week.
    const e = estimateSsp(base({ pay: weekdayPay("2026-09-21", "2026-10-02", 100), sickDates: ["2026-10-05"] }));
    expect(e.awe).toBe(500);
  });

  it("no pay before the sickness: not guessed, explained", () => {
    const e = estimateSsp(base({ pay: [], sickDates: ["2026-10-07"] }));
    expect(e.days).toEqual([{ date: "2026-10-07", amount: null }]);
    expect(e.total).toBe(0);
    expect(e.notes[0]).toMatch(/No pay in the 8 weeks/);
  });

  it("spells 56 days apart or less link: average earnings taken at the first", () => {
    // 10 Aug – 4 Oct is 56 clear days between: linked. One more: not.
    expect(linkedRunStart(["2026-08-09", "2026-10-05"], "2026-10-05")).toBe("2026-08-09");
    expect(linkedRunStart(["2026-08-08", "2026-10-05"], "2026-10-05")).toBe("2026-10-05");
    // AWE from before 10 Aug: pay was £50 a day then, £100 a day later.
    const pay = [...weekdayPay("2026-06-01", "2026-08-09", 50), ...weekdayPay("2026-08-10", "2026-10-24", 100)];
    const e = estimateSsp(base({ pay, earlierSickDates: ["2026-08-10"], sickDates: ["2026-10-05"] }));
    expect(e.awe).toBe(250);
    expect(e.weeklySsp).toBe(123.25);
  });

  it("stops at 28 weeks across linked spells", () => {
    // 28 weeks × 5 days already used (Mon–Fri sick since mid-April), then one more day.
    const earlier: string[] = [];
    for (let d = "2026-04-13"; earlier.length < 140; d = addDaysIso(d, 1)) {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (dow >= 1 && dow <= 5) earlier.push(d);
    }
    const next = addDaysIso(earlier[earlier.length - 1], 3); // the following Monday
    const e = estimateSsp(base({ pay: weekdayPay("2026-01-05", "2026-04-10", 100), lookbackFrom: "2026-01-01", earlierSickDates: earlier, sickDates: [next] }));
    expect(e.days).toEqual([{ date: next, amount: 0 }]);
    expect(e.notes.some(n => n.includes("28-week"))).toBe(true);
  });

  it("sickness running since before 6 April 2026 keeps the old rules — not estimated", () => {
    const e = estimateSsp(base({ lookbackFrom: "2026-01-01", earlierSickDates: ["2026-04-01"], sickDates: ["2026-05-01"] }));
    expect(e.days).toEqual([{ date: "2026-05-01", amount: null }]);
    expect(e.notes[0]).toMatch(/before 6 April 2026/);
  });

  it("warns when the sickness may link back past where it looked", () => {
    const e = estimateSsp(base({ lookbackFrom: "2026-09-01", earlierSickDates: ["2026-09-02"], sickDates: ["2026-10-07"] }));
    expect(e.notes.some(n => n.includes("may link back"))).toBe(true);
  });
});
