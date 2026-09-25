import { describe, it, expect } from "vitest";
import {
  buildReport, headline, viewerReport, rangeFrom, rangeFigure, previousPeriod, rangeHeadline, clampRange,
  FOUNDER_ONLY_KEYS, type StoredDay,
} from "./team-efficiency-report";

const STANDARD = 5;

function day(date: string, credited: number, labour: number, p: Partial<StoredDay> = {}): StoredDay {
  return {
    date, status: "ok", flags: [], packsByLine: { "Line A": 400 }, eightPackBags: 0,
    ordersDespatched: 100, packsDespatched: 300,
    efficiencyPct: labour > 0 ? (credited / labour / STANDARD) * 100 : null,
    ratio: labour > 0 ? credited / labour : null,
    valueCredited: credited, valueMadeNet: credited, valueDespatchedNet: credited, labourCost: labour, paidHours: 60,
    ...p,
  };
}

// Two weeks of weekdays: week 1 at exactly the standard, week 2 at 120%.
const wk1 = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"].map(d => day(d, 5000, 1000));
const wk2 = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"].map(d => day(d, 6000, 1000));
const flagged = day("2026-09-19", 100, 1000, {
  status: "excluded", efficiencyPct: null,
  flags: [{ code: "uncounted_output", line: "Line C", message: "Uncounted output: Line C was planned but nothing was counted" }],
});
const pending = day("2026-09-21", 0, 0, { status: "pending", ratio: null, efficiencyPct: null, flags: [{ code: "pending_approval", message: "Waiting" }] });
const history = [...wk1, ...wk2, flagged, pending];

describe("buildReport", () => {
  const r = buildReport(history, STANDARD, "2026-09-01", "2026-09-30");

  it("weekly and monthly figures are ratios of sums over counted days only", () => {
    expect(r.weekly.map(w => w.period)).toEqual(["2026-09-07", "2026-09-14", "2026-09-21"]);
    expect(r.weekly[0].pct).toBeCloseTo(100, 6);
    expect(r.weekly[1].pct).toBeCloseTo(120, 6);
    expect(r.weekly[2].pct).toBeNull(); // only a pending day so far
    const sepWeek2 = r.weekly[1];
    expect(sepWeek2.countedDays).toBe(5);
    expect(sepWeek2.flaggedDays).toBe(1); // the 19th sits in the week of the 14th
    expect(r.monthly).toHaveLength(1);
    expect(r.monthly[0].pct).toBeCloseTo((55000 / 10000 / STANDARD) * 100, 6);
    expect(r.monthly[0].countedDays).toBe(10);
  });

  it("rolls the last 7 counted days, skipping flagged ones", () => {
    const byDate = new Map(r.days.map(d => [d.date, d]));
    // On the 18th the window is the 7 counted days 10–18 Sep: 2 at 100%, 5 at 120%.
    const win = [...wk1.slice(3), ...wk2];
    const expected = (win.reduce((n, d) => n + d.valueCredited, 0) / win.reduce((n, d) => n + d.labourCost, 0) / STANDARD) * 100;
    expect(byDate.get("2026-09-18")!.rollingPct).toBeCloseTo(expected, 6);
    // A flagged day carries the rolling figure on but doesn't move it.
    expect(byDate.get("2026-09-19")!.rollingPct).toBeCloseTo(expected, 6);
    // A pending day has no rolling figure yet.
    expect(byDate.get("2026-09-21")!.rollingPct).toBeNull();
  });

  it("limits the days to the range but rolls from earlier history", () => {
    const narrow = buildReport(history, STANDARD, "2026-09-14", "2026-09-30");
    expect(narrow.days[0].date).toBe("2026-09-14");
    expect(narrow.days[0].rollingPct).toBeCloseTo(((5 * 5000 + 6000) / 6000 / STANDARD) * 100, 6);
  });
});

describe("headline", () => {
  it("compares the last 7 counted days with the 7 before", () => {
    const more = [...["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"].map(d => day(d, 5000, 1000)), ...history];
    const h = headline(more, STANDARD);
    const last = [...wk1.slice(3), ...wk2]; // 7 counted days
    const pct = (last.reduce((n, d) => n + d.valueCredited, 0) / 7000 / STANDARD) * 100;
    expect(h.pct).toBeCloseTo(pct, 6);
    expect(h.previousPct).toBeCloseTo(100, 6);
    expect(h.changePts).toBeCloseTo(pct - 100, 6);
    expect(h.from).toBe("2026-09-10");
    expect(h.to).toBe("2026-09-18");
  });

  it("has no comparison until there are 14 counted days", () => {
    expect(headline(wk2, STANDARD).previousPct).toBeNull();
    expect(headline([], STANDARD).pct).toBeNull();
  });
});

describe("custom ranges", () => {
  it("the range figure is value-weighted, not a mean of daily percentages", () => {
    // A small 200% day and a big 50% day: the mean of % would say 125%.
    const days = [day("2026-09-01", 2000, 200), day("2026-09-02", 5000, 2000)];
    const f = rangeFigure(days, STANDARD, "2026-09-01", "2026-09-02");
    expect(f.pct).toBeCloseTo((7000 / 2200 / STANDARD) * 100, 6);
    expect(f.pct).toBeLessThan(70);
    expect(f.countedDays).toBe(2);
  });

  it("leaves flagged and pending days out of the range figure", () => {
    const f = rangeFigure(history, STANDARD, "2026-09-14", "2026-09-21");
    expect(f.pct).toBeCloseTo(120, 6);
    expect(f.countedDays).toBe(5);
    expect(f.flaggedDays).toBe(2);
  });

  it("compares with the same number of calendar days immediately before", () => {
    expect(previousPeriod("2026-09-14", "2026-09-20")).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    expect(previousPeriod("2026-09-01", "2026-09-01")).toEqual({ from: "2026-08-31", to: "2026-08-31" });
    expect(previousPeriod("2026-03-01", "2026-03-31")).toEqual({ from: "2026-01-29", to: "2026-02-28" });
    const h = rangeHeadline(history, STANDARD, "2026-09-14", "2026-09-20");
    expect(h.kind).toBe("range");
    expect(h.pct).toBeCloseTo(120, 6);
    expect(h.previousPct).toBeCloseTo(100, 6);
    expect(h.changePts).toBeCloseTo(20, 6);
    expect([h.from, h.to, h.previousFrom, h.previousTo]).toEqual(["2026-09-14", "2026-09-20", "2026-09-07", "2026-09-13"]);
  });

  it("has no comparison when the period before has no counted days", () => {
    const h = rangeHeadline(history, STANDARD, "2026-09-07", "2026-09-11");
    expect(h.pct).toBeCloseTo(100, 6);
    expect(h.previousPct).toBeNull();
    expect(h.changePts).toBeNull();
  });

  it("buildReport uses the range headline when asked", () => {
    const r = buildReport(history, STANDARD, "2026-09-14", "2026-09-20", { headline: "range" });
    expect(r.headline.kind).toBe("range");
    expect(r.days.map(d => d.date)).toEqual(["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"]);
    expect(viewerReport(r).headline.previousFrom).toBe("2026-09-07");
  });

  it("clamps a range to the stored history", () => {
    const b = { min: "2026-03-30", max: "2026-09-24" };
    expect(clampRange("2026-01-01", "2026-12-31", b)).toEqual({ from: "2026-03-30", to: "2026-09-24" });
    expect(clampRange("2026-05-01", "2026-05-31", b)).toEqual({ from: "2026-05-01", to: "2026-05-31" });
    expect(clampRange("2026-05-31", "2026-05-01", b)).toEqual({ from: "2026-05-01", to: "2026-05-31" }); // swapped
    expect(clampRange("2025-01-01", "2025-02-01", b)).toBeNull();
    expect(clampRange("2026-05-01", "2026-05-31", { min: null, max: null })).toEqual({ from: "2026-05-01", to: "2026-05-31" });
  });
});

describe("rangeFrom", () => {
  it("steps back 30 days / 3 / 6 / 12 months", () => {
    expect(rangeFrom("30d", "2026-09-25")).toBe("2026-08-26");
    expect(rangeFrom("12m", "2026-09-25")).toBe("2025-09-25");
  });
});

describe("viewerReport — pay stays with the founder (regression)", () => {
  const full = buildReport(history, STANDARD, "2026-09-01", "2026-09-30");
  const viewer = viewerReport(full);
  const json = JSON.stringify(viewer);

  it("contains no £ or R field anywhere, for a custom range too", () => {
    const custom = JSON.stringify(viewerReport(buildReport(history, STANDARD, "2026-09-14", "2026-09-20", { headline: "range" })));
    for (const key of FOUNDER_ONLY_KEYS) expect(custom).not.toContain(`"${key}"`);
    for (const key of FOUNDER_ONLY_KEYS) expect(json).not.toContain(`"${key}"`);
    expect(json).not.toContain("£");
  });

  it("still carries the percentages, packs and orders", () => {
    expect(viewer.days).toHaveLength(full.days.length);
    expect(viewer.days[0].efficiencyPct).toBe(full.days[0].efficiencyPct);
    expect(viewer.days[0].packsByLine).toEqual({ "Line A": 400 });
    expect(viewer.weekly[0].pct).toBe(full.weekly[0].pct);
    expect(viewer.headline.pct).toBe(full.headline.pct);
  });

  it("does not leak a £ field added to a day object later", () => {
    const sneaky = { ...full, days: full.days.map(d => ({ ...d, grossPay: 123 })) };
    expect(JSON.stringify(viewerReport(sneaky))).not.toContain("grossPay");
  });
});
