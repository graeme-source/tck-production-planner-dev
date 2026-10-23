import { describe, it, expect } from "vitest";
import {
  productionDates,
  lastProductionDays,
  pickLastProductionDay,
  calendarDaysBetween,
  kpiSeries,
  groupByLondonDate,
  type ProductionDayKpis,
} from "./last-production-day";

// Oct 2026: Fri 16, Sat 17, Sun 18, Mon 19, Tue 20, Wed 21, Thu 22.
const MON_TO_FRI = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];

describe("pickLastProductionDay", () => {
  it("Monday looks back over the weekend to Friday", () => {
    expect(pickLastProductionDay("2026-10-19", MON_TO_FRI)).toBe("2026-10-16");
  });

  it("Tuesday after a Monday off (bank holiday) goes back to Friday — by data, not weekday rules", () => {
    expect(pickLastProductionDay("2026-10-20", MON_TO_FRI)).toBe("2026-10-16");
  });

  it("a normal Wednesday is Tuesday", () => {
    expect(pickLastProductionDay("2026-10-21", [...MON_TO_FRI, "2026-10-19", "2026-10-20"])).toBe("2026-10-20");
  });

  it("never picks today, even when today already has production logged", () => {
    expect(pickLastProductionDay("2026-10-16", MON_TO_FRI)).toBe("2026-10-15");
  });

  it("a Saturday that was worked counts like any other day", () => {
    expect(pickLastProductionDay("2026-10-19", [...MON_TO_FRI, "2026-10-17"])).toBe("2026-10-17");
  });

  it("no history gives null (the slide's empty state)", () => {
    expect(pickLastProductionDay("2026-10-19", [])).toBeNull();
    expect(pickLastProductionDay("2026-10-19", ["2026-10-19", "2026-10-20"])).toBeNull();
  });
});

describe("lastProductionDays", () => {
  it("returns the last 7 production days before today, oldest first, skipping gaps", () => {
    const active = [...MON_TO_FRI, "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"];
    expect(lastProductionDays("2026-10-22", active)).toEqual([
      "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21",
    ]);
  });

  it("returns fewer when there isn't a week of history, and de-duplicates", () => {
    expect(lastProductionDays("2026-10-19", ["2026-10-16", "2026-10-15", "2026-10-16"])).toEqual(["2026-10-15", "2026-10-16"]);
  });
});

describe("productionDates", () => {
  it("ignores prep-ahead stations — tomorrow's dough doesn't make tomorrow a production day", () => {
    expect(productionDates([
      { date: "2026-10-21", stationType: "building_1", recipeCategory: "Calzone" },
      { date: "2026-10-22", stationType: "dough_prep", recipeCategory: "Calzone" },
    ])).toEqual(["2026-10-21"]);
  });

  it("ignores the separate kitchen and KPI-excluded recipes", () => {
    expect(productionDates([
      { date: "2026-10-18", stationType: "fried_chicken", recipeCategory: "Fried Chicken" },
      { date: "2026-10-17", stationType: "building_1", recipeCategory: "Desserts", excludeFromKpis: true },
      { date: "2026-10-16", stationType: "ovens", recipeCategory: "Macaroni Cheese" },
      { date: "2026-10-16", stationType: "ovens", recipeCategory: "Calzone" },
    ])).toEqual(["2026-10-16"]);
  });
});

describe("calendarDaysBetween", () => {
  it("counts whole days, across the October clock change too", () => {
    expect(calendarDaysBetween("2026-10-16", "2026-10-19")).toBe(3);
    expect(calendarDaysBetween("2026-10-23", "2026-10-26")).toBe(3);
    expect(calendarDaysBetween("2026-10-21", "2026-10-22")).toBe(1);
  });
});

describe("kpiSeries", () => {
  const day = (over: Partial<ProductionDayKpis>): ProductionDayKpis => ({
    builderBatchesPerHour: 20, packingBatchesPerHour: 30, wonkyCount: 5, dogBinCount: 1,
    shortCount: 0, leftoverFillingGrams: 100, batchesTarget: 90, improvementsCompleted: 2,
    defects: { count: 8, pct: 1.2, packsMade: 660 }, ...over,
  });

  it("lines each KPI up in day order; a missing day or failed lookup is a gap, not zero", () => {
    const s = kpiSeries(["a", "b", "c"], new Map([
      ["a", day({ builderBatchesPerHour: 18 })],
      ["c", day({ builderBatchesPerHour: null, defects: null, improvementsCompleted: null })],
    ]));
    expect(s.builder_rate).toEqual([18, null, null]);
    expect(s.wonkies).toEqual([5, null, 5]);
    expect(s.improvements).toEqual([2, null, null]);
  });

  it("trends defects on the rate, not the count", () => {
    const s = kpiSeries(["a"], new Map([["a", day({})]]));
    expect(s.defects).toEqual([1.2]);
  });
});

describe("groupByLondonDate", () => {
  it("buckets by the supplied London-date function", () => {
    const rows = [{ t: new Date("2026-10-20T23:30:00Z") }, { t: new Date("2026-10-20T10:00:00Z") }];
    const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
    const g = groupByLondonDate(rows, r => r.t, fmt);
    // 23:30 UTC on 20 Oct is 00:30 BST on 21 Oct.
    expect(g.get("2026-10-21")?.length).toBe(1);
    expect(g.get("2026-10-20")?.length).toBe(1);
  });
});
