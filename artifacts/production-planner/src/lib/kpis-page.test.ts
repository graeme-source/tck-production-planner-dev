import { describe, expect, it } from "vitest";
import {
  KPIS_PATH, capRange, kpiHref, legacyKpiHref, parseKpiView, rangeTrend, runRateSeries, trendWords, visibleKpiViews,
  type RunRateDay,
} from "./kpis-page";

describe("parseKpiView", () => {
  it("opens the KPI named in the address", () => {
    expect(parseKpiView("?kpi=run-rate")).toBe("run-rate");
    expect(parseKpiView("kpi=defects&from=2026-01-01")).toBe("defects");
  });
  it("falls back to the overview for a missing or unknown KPI", () => {
    expect(parseKpiView("")).toBe("overview");
    expect(parseKpiView("?kpi=nonsense")).toBe("overview");
  });
});

describe("kpiHref", () => {
  it("puts the KPI first and keeps the rest of the query", () => {
    expect(kpiHref("efficiency", "range=3m")).toBe(`${KPIS_PATH}?kpi=efficiency&range=3m`);
    expect(kpiHref("run-rate", "?kpi=defects")).toBe(`${KPIS_PATH}?kpi=run-rate`);
  });
  it("leaves the overview bare", () => {
    expect(kpiHref("overview")).toBe(KPIS_PATH);
  });
});

describe("legacyKpiHref — the old addresses still land somewhere sensible", () => {
  it("sends the old Production KPIs page to All targets", () => {
    expect(legacyKpiHref("/analytics/production-kpis", "")).toBe(`${KPIS_PATH}?kpi=targets`);
  });
  it("sends Team efficiency with its range", () => {
    expect(legacyKpiHref("/analytics/efficiency", "?from=2026-08-01&to=2026-08-31"))
      .toBe(`${KPIS_PATH}?kpi=efficiency&from=2026-08-01&to=2026-08-31`);
  });
  it("sends Defects & waste", () => {
    expect(legacyKpiHref("/analytics/defects", "")).toBe(`${KPIS_PATH}?kpi=defects`);
  });
  it("sends Analytics' old Production KPIs and Packing Speed tabs", () => {
    expect(legacyKpiHref("/reports", "?tab=kpis")).toBe(`${KPIS_PATH}?kpi=run-rate`);
    expect(legacyKpiHref("/reports", "?tab=packing-speed")).toBe(`${KPIS_PATH}?kpi=packing`);
  });
  it("leaves every other Analytics tab alone", () => {
    expect(legacyKpiHref("/reports", "")).toBeNull();
    expect(legacyKpiHref("/reports", "?tab=haccp")).toBeNull();
    expect(legacyKpiHref("/dashboard", "")).toBeNull();
  });
});

describe("visibleKpiViews", () => {
  it("hides Team efficiency from anyone below manager", () => {
    expect(visibleKpiViews(false).some(v => v.id === "efficiency")).toBe(false);
    expect(visibleKpiViews(true).some(v => v.id === "efficiency")).toBe(true);
  });
});

const day = (date: string, bph: number | null, activeMinutes = 300): RunRateDay => ({ date, bph, activeMinutes, batches: 100 });

describe("runRateSeries", () => {
  it("puts the days oldest first and colours each against the standard", () => {
    const s = runRateSeries([day("2026-11-03", 23), day("2026-11-02", 20), day("2026-11-01", 17)], 20);
    expect(s.map(p => p.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(s.map(p => p.band)).toEqual(["red", "green", "platinum"]);
  });

  it("averages each day with the production days before it", () => {
    const s = runRateSeries([day("2026-11-01", 18), day("2026-11-02", 20), day("2026-11-03", 22)], 20, 7);
    expect(s.map(p => p.rolling)).toEqual([18, 19, 20]);
  });

  it("drops days outside the window", () => {
    const s = runRateSeries([day("2026-11-01", 10), day("2026-11-02", 20), day("2026-11-03", 30), day("2026-11-04", 40)], 20, 3);
    expect(s[3].rolling).toBe(30);
  });

  it("leaves a day with no figure as a gap, never a zero", () => {
    const s = runRateSeries([day("2026-11-01", 20), day("2026-11-02", null, 0), day("2026-11-03", 22), day("2026-11-04", 24)], 20);
    expect(s[1].daily).toBeNull();
    expect(s[1].band).toBe("neutral");
    // The gap is left out of the average, not counted as 0.
    expect(s[3].rolling).toBe(22);
  });
});

const days = (start: number, values: number[]) =>
  values.map((v, i) => day(`2026-11-${String(start + i).padStart(2, "0")}`, v));

describe("rangeTrend", () => {
  it("compares the rolling average at the start and end of the range", () => {
    const s = runRateSeries(days(1, [18, 18, 18, 26, 26, 26]), 20, 3);
    const t = rangeTrend(s)!;
    expect(t.start).toBe(18);
    expect(t.end).toBe(26);
    expect(t.direction).toBe("up");
    expect(t.pct).toBe(44);
    expect(trendWords(t)).toBe("Up 44%");
  });

  it("reads a tiny change as level", () => {
    const t = rangeTrend(runRateSeries(days(1, [20, 20, 20, 20.1]), 20))!;
    expect(t.direction).toBe("flat");
    expect(trendWords(t)).toBe("Level");
  });

  it("says down when it's fallen", () => {
    const t = rangeTrend(runRateSeries(days(1, [22, 22, 22, 19, 19, 19]), 20, 3))!;
    expect(trendWords(t)).toBe("Down 14%");
  });

  it("starts from the first full 7-day average on a long range, not one odd first day", () => {
    // Day 1 is a one-off 30; days 2–14 are a steady 20.
    const t = rangeTrend(runRateSeries(days(1, [30, ...Array(13).fill(20)]), 20))!;
    expect(t.startDate).toBe("2026-11-07");
    expect(t.start).toBe(21.4); // (30 + 6×20) ÷ 7
    expect(t.end).toBe(20);
  });

  it("needs two points", () => {
    expect(rangeTrend(runRateSeries([day("2026-11-01", 20)], 20))).toBeNull();
    expect(rangeTrend([])).toBeNull();
  });
});

describe("capRange — packing speed asks Shopify once per day", () => {
  it("keeps a short range as it is", () => {
    expect(capRange("2026-11-01", "2026-11-16", 31)).toEqual({ from: "2026-11-01", to: "2026-11-16", capped: false });
  });
  it("keeps the last 31 days of a long range", () => {
    expect(capRange("2026-08-16", "2026-11-16", 31)).toEqual({ from: "2026-10-17", to: "2026-11-16", capped: true });
  });
  it("counts both ends — exactly 31 days is not capped", () => {
    expect(capRange("2026-10-17", "2026-11-16", 31).capped).toBe(false);
  });
});
