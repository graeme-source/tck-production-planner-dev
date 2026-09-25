import { describe, it, expect } from "vitest";
import {
  shiftPay, shiftPaidHours, isProductiveShift, effectiveNiRate, onCostMultiplier,
  netValue, creditedValue, standardRatio, dailyEfficiency, median,
} from "./team-efficiency";

const PRODUCTION = 13937;
const OFFICE = 13503;

// Shape of a real Planday payroll row: 07:00–16:20 at £12.75, two unpaid breaks
// (20 + 25 min). Planday's salary is the full 9h20m; the breaks carry the deduction.
const shift = {
  salary: 119, // 9h20m × £12.75
  start: "2026-07-20T07:00:00",
  end: "2026-07-20T16:20:00",
  breaks: [
    { duration: 20 / 60, amount: -(20 / 60) * 12.75, isPaid: false },
    { duration: 25 / 60, amount: -(25 / 60) * 12.75, isPaid: false },
  ],
};

describe("team efficiency — shift pay", () => {
  it("takes unpaid breaks off Planday's salary", () => {
    expect(shiftPay(shift)).toBeCloseTo(119 - 0.75 * 12.75, 6);
    expect(shiftPaidHours(shift)).toBeCloseTo(9 + 20 / 60 - 0.75, 6);
  });

  it("leaves paid breaks alone", () => {
    const paid = { ...shift, breaks: [{ duration: 0.25, amount: 0, isPaid: true }] };
    expect(shiftPay(paid)).toBe(119);
    expect(shiftPaidHours(paid)).toBeCloseTo(9 + 20 / 60, 6);
  });
});

describe("team efficiency — productive shifts", () => {
  it("counts positions in the Production section", () => {
    expect(isProductiveShift(PRODUCTION, PRODUCTION, null)).toBe(true);
    expect(isProductiveShift(PRODUCTION, PRODUCTION, "Arrived late")).toBe(true);
  });
  it("drops Office positions and unsectioned positions", () => {
    expect(isProductiveShift(OFFICE, PRODUCTION, null)).toBe(false);
    expect(isProductiveShift(null, PRODUCTION, null)).toBe(false);
  });
  it("drops training, meetings, holiday, sickness and leave even in Production", () => {
    for (const t of ["Training", "Meeting", "Holiday (with Pay)", "Sick Leave", "Absent", "Dependants Leave"]) {
      expect(isProductiveShift(PRODUCTION, PRODUCTION, t)).toBe(false);
    }
  });
});

describe("team efficiency — on-costs", () => {
  const s = { holidayAccrual: 0.1207, niRate: 0.15, niWeeklyThreshold: 96.15, employmentAllowanceAnnual: 10500, pensionRate: 0.03 };

  it("applies NI above the weekly threshold, less the pro-rated allowance", () => {
    // One person, one week, £400 → £448.28 with holiday; NI = (448.28 − 96.15) × 15% = 52.82;
    // allowance for 7 days = 201.37 → wiped out.
    expect(effectiveNiRate([400], 1, s)).toBe(0);
    // Twenty people at £400 for a week: NI 1056.39 − 201.37 = 855.02 over 8965.6 of pay.
    expect(effectiveNiRate(Array(20).fill(400), 1, s)).toBeCloseTo(855.02 / 8965.6, 4);
  });

  it("multiplier = (1 + holiday) × (1 + NI + pension)", () => {
    expect(onCostMultiplier(0.08, s)).toBeCloseTo(1.1207 * 1.11, 6);
  });
});

describe("team efficiency — value and ratio", () => {
  it("values packs net of the category discount", () => {
    expect(netValue([
      { packs: 100, rrp: 13.65, discountRate: 0.22 },
      { packs: 10, rrp: 10.95, discountRate: 0.04 },
    ])).toBeCloseTo(100 * 13.65 * 0.78 + 10 * 10.95 * 0.96, 6);
  });

  it("splits credit between production and despatch", () => {
    expect(creditedValue(5000, 6000, 0.11)).toBeCloseTo(0.89 * 5000 + 0.11 * 6000, 6);
    expect(creditedValue(5000, 6000, 0)).toBe(5000);
  });

  it("median handles odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("standard ignores excluded and no-labour days", () => {
    const days = [
      { date: "a", credited: 400, labourCost: 100 },
      { date: "b", credited: 500, labourCost: 100 },
      { date: "c", credited: 600, labourCost: 100 },
      { date: "d", credited: 10, labourCost: 100, exclude: true },
      { date: "e", credited: 50, labourCost: 0 },
    ];
    expect(standardRatio(days)).toBe(5);
  });

  it("daily and rolling efficiency; rolling is a ratio of sums and skips excluded days", () => {
    const days = [
      { date: "1", credited: 400, labourCost: 100 },
      { date: "2", credited: 1200, labourCost: 200 },
      { date: "3", credited: 10, labourCost: 100, exclude: true },
      { date: "4", credited: 0, labourCost: 0 },
    ];
    const out = dailyEfficiency(days, 5, 2);
    expect(out[0].efficiencyPct).toBeCloseTo(80, 6);
    expect(out[1].efficiencyPct).toBeCloseTo(120, 6);
    expect(out[1].rollingPct).toBeCloseTo((1600 / 300) / 5 * 100, 6);
    // excluded day still gets its own figure, but the rolling one ignores it
    expect(out[2].efficiencyPct).toBeCloseTo(2, 6);
    expect(out[2].rollingPct).toBeCloseTo(out[1].rollingPct!, 6);
    // no labour → no ratio, never a zero
    expect(out[3].ratio).toBeNull();
    expect(out[3].efficiencyPct).toBeNull();
  });
});
