import { describe, expect, it } from "vitest";
import {
  defaultSplitPacks,
  nextSplitOrderDate,
  packsAfterSplits,
  splitDateLabel,
  splitFromLabel,
  splitPacksProblem,
  supplierOrderWeekdays,
} from "./order-split";

// 2026-10-05 is a Monday.
const MON = "2026-10-05";
const weeklyTue = { orderFrequency: "weekly", orderDays: "Tuesday" };
const daily = { orderFrequency: "daily", orderDays: null };

describe("nextSplitOrderDate — where a split lands (#248 + #328)", () => {
  it("Jane's case: split on Monday from Express → A D Maria's Tuesday", () => {
    expect(nextSplitOrderDate({ todayIso: MON, supplier: weeklyTue, placedOrderDates: new Set() })).toBe("2026-10-06");
  });

  it("skips an order day the supplier has already placed", () => {
    expect(nextSplitOrderDate({ todayIso: MON, supplier: weeklyTue, placedOrderDates: new Set(["2026-10-06"]) })).toBe("2026-10-13");
  });

  it("today counts when the supplier orders today and nothing has gone yet", () => {
    expect(nextSplitOrderDate({ todayIso: MON, supplier: daily, placedOrderDates: new Set() })).toBe(MON);
    expect(nextSplitOrderDate({ todayIso: MON, supplier: daily, placedOrderDates: new Set([MON]) })).toBe("2026-10-06");
  });

  it("daily suppliers order on weekdays only — Friday's placed order rolls to Monday", () => {
    expect(nextSplitOrderDate({ todayIso: "2026-10-09", supplier: daily, placedOrderDates: new Set(["2026-10-09"]) })).toBe("2026-10-12");
  });

  it("several set days, any case and spacing", () => {
    const s = { orderFrequency: "weekly", orderDays: "monday, Thursday" };
    expect([...supplierOrderWeekdays(s)].sort()).toEqual([1, 4]);
    expect(nextSplitOrderDate({ todayIso: "2026-10-06", supplier: s, placedOrderDates: new Set() })).toBe("2026-10-08");
  });

  it("weekly with no days set behaves like a weekday supplier; nothing reachable → null", () => {
    expect(supplierOrderWeekdays({ orderFrequency: "weekly", orderDays: "" })).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(nextSplitOrderDate({ todayIso: MON, supplier: weeklyTue, placedOrderDates: new Set(["2026-10-06"]), horizonDays: 3 })).toBeNull();
  });
});

describe("split labels and amounts", () => {
  it("labels", () => {
    expect(splitDateLabel("2026-10-06")).toBe("Tue 6 Oct");
    expect(splitFromLabel("Express Food Service", MON)).toBe("Split from Express Food Service, Mon");
  });

  it("half by default, the odd pack stays with today's supplier", () => {
    expect(defaultSplitPacks(20)).toBe(10);
    expect(defaultSplitPacks(21)).toBe(10);
    expect(defaultSplitPacks(1)).toBe(1);
    expect(defaultSplitPacks(0)).toBe(0);
  });

  it("checks the amount", () => {
    expect(splitPacksProblem(10, 20)).toBeNull();
    expect(splitPacksProblem(0, 20)).toMatch(/at least 1/);
    expect(splitPacksProblem(1.5, 20)).toMatch(/whole/);
    expect(splitPacksProblem(21, 20)).toMatch(/only has 20/);
  });

  it("packs after splits: today's line keeps the rest, the target gets a fixed amount", () => {
    expect(packsAfterSplits(20, 10, 0)).toBe(10);   // Express on Monday
    expect(packsAfterSplits(0, 0, 10)).toBe(10);    // A D Maria on Tuesday
    expect(packsAfterSplits(3, 10, 0)).toBe(0);     // never below zero
    expect(packsAfterSplits(4, 0, 10)).toBe(14);    // its own need plus the split
  });
});
