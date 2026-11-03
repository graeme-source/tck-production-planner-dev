import { describe, expect, it } from "vitest";
import {
  dueStandingOrders,
  isStandingOrderDay,
  packsWithStandingFloor,
  parseStandingPacks,
  parseStandingWeekdays,
  standingDaysSupplierSkips,
  standingOrderFrom,
  standingOrderLabel,
  standingOrderStatus,
  type StandingOrderMark,
} from "./standing-order";
import { packsAfterSplits } from "./order-split";

// 2026-11-06 is a Friday; 2026-11-05 a Thursday; 2026-11-13 the next Friday.
const FRI = "2026-11-06";
const THU = "2026-11-05";
const NEXT_FRI = "2026-11-13";
const everyFri = { weekdays: [5 as const], packs: 2 };

describe("parseStandingWeekdays / parseStandingPacks", () => {
  it("cleans, sorts and de-duplicates weekdays from the column or a string", () => {
    expect(parseStandingWeekdays([5, 1, 5])).toEqual([1, 5]);
    expect(parseStandingWeekdays("5, 1")).toEqual([1, 5]);
    expect(parseStandingWeekdays(["3", 0, 8, 2.5, "x", null])).toEqual([3]);
    expect(parseStandingWeekdays(null)).toEqual([]);
  });

  it("packs are whole, positive and capped", () => {
    expect(parseStandingPacks(3)).toBe(3);
    expect(parseStandingPacks("2")).toBe(2);
    expect(parseStandingPacks(1.6)).toBe(2);
    expect(parseStandingPacks(-1)).toBe(0);
    expect(parseStandingPacks("")).toBe(0);
    expect(parseStandingPacks(null)).toBe(0);
    expect(parseStandingPacks(100000)).toBe(999);
  });

  it("reads an ingredient row's two columns", () => {
    expect(standingOrderFrom({ standingOrderWeekdays: [5], standingOrderPacks: 2 })).toEqual(everyFri);
    expect(standingOrderFrom({ standingOrderWeekdays: null, standingOrderPacks: null })).toEqual({ weekdays: [], packs: 0 });
  });
});

describe("is it due today? (Jane: bananas on the AB Fruits order every Friday)", () => {
  it("due on a chosen weekday, not on others", () => {
    expect(isStandingOrderDay(everyFri, FRI)).toBe(true);
    expect(isStandingOrderDay(everyFri, THU)).toBe(false);
  });

  it("off when no days or no packs are set", () => {
    expect(isStandingOrderDay({ weekdays: [], packs: 2 }, FRI)).toBe(false);
    expect(isStandingOrderDay({ weekdays: [5], packs: 0 }, FRI)).toBe(false);
  });

  it("several days", () => {
    const monFri = { weekdays: [1 as const, 5 as const], packs: 1 };
    expect(isStandingOrderDay(monFri, "2026-11-02")).toBe(true);
    expect(isStandingOrderDay(monFri, FRI)).toBe(true);
    expect(isStandingOrderDay(monFri, THU)).toBe(false);
  });
});

describe("standingOrderStatus — once handled, it doesn't come back that day", () => {
  it("due with no mark", () => {
    expect(standingOrderStatus(everyFri, FRI, null)).toBe("due");
  });

  it("ordered or skipped today stays off today", () => {
    expect(standingOrderStatus(everyFri, FRI, "ordered")).toBe("ordered");
    expect(standingOrderStatus(everyFri, FRI, "skipped")).toBe("skipped");
  });

  it("not a chosen day: not due, whatever the mark", () => {
    expect(standingOrderStatus(everyFri, THU, null)).toBe("not_due");
    expect(standingOrderStatus(everyFri, THU, "skipped")).toBe("not_due");
  });
});

describe("dueStandingOrders", () => {
  const rows = [
    { ingredientId: 1, standingOrderWeekdays: [5], standingOrderPacks: 2 }, // bananas
    { ingredientId: 2, standingOrderWeekdays: [5], standingOrderPacks: 1 }, // clementines
    { ingredientId: 3, standingOrderWeekdays: [5], standingOrderPacks: 1 }, // apples
    { ingredientId: 4, standingOrderWeekdays: [4], standingOrderPacks: 1 }, // Thursday item
    { ingredientId: 5, standingOrderWeekdays: null, standingOrderPacks: 3 }, // off
  ];

  it("Friday: the three Friday items, minus any ordered or skipped today", () => {
    const marks = new Map<number, StandingOrderMark>([[2, "ordered"], [3, "skipped"]]);
    const due = dueStandingOrders(rows, FRI, marks);
    expect(due.map(r => r.ingredientId)).toEqual([1]);
    expect(due[0].standing).toEqual(everyFri);
  });

  it("next Friday everything is due again (marks are per day)", () => {
    expect(dueStandingOrders(rows, NEXT_FRI, new Map()).map(r => r.ingredientId)).toEqual([1, 2, 3]);
  });

  it("Thursday: only the Thursday item", () => {
    expect(dueStandingOrders(rows, THU, new Map()).map(r => r.ingredientId)).toEqual([4]);
  });
});

describe("standingOrderLabel", () => {
  it("reads like the card chip", () => {
    expect(standingOrderLabel([5])).toBe("Every Fri");
    expect(standingOrderLabel([5, 1])).toBe("Every Mon & Fri");
    expect(standingOrderLabel([1, 3, 5])).toBe("Every Mon, Wed & Fri");
    expect(standingOrderLabel([1, 2, 3, 4, 5, 6, 7])).toBe("Every day");
    expect(standingOrderLabel([])).toBe("");
  });
});

describe("packsWithStandingFloor — never doubles a normal suggestion", () => {
  it("standing-only line: the fixed packs", () => {
    expect(packsWithStandingFloor(0, 2)).toBe(2);
  });

  it("stock maths already asks for more: that wins", () => {
    expect(packsWithStandingFloor(5, 2)).toBe(5);
  });

  it("stock maths asks for less: lifted to the standing packs", () => {
    expect(packsWithStandingFloor(1, 3)).toBe(3);
  });

  it("no standing order: unchanged", () => {
    expect(packsWithStandingFloor(4, null)).toBe(4);
    expect(packsWithStandingFloor(0, 0)).toBe(0);
  });

  it("split-in / queued packs stay on top of the floor", () => {
    const afterAway = packsAfterSplits(1, 0, 0);
    expect(packsWithStandingFloor(afterAway, 3) + 4).toBe(7);
  });
});

describe("standingDaysSupplierSkips", () => {
  it("weekly supplier that doesn't order on the chosen day", () => {
    expect(standingDaysSupplierSkips([5], { orderFrequency: "weekly", orderDays: "Monday,Thursday" })).toEqual([5]);
    expect(standingDaysSupplierSkips([4, 5], { orderFrequency: "weekly", orderDays: "Thursday" })).toEqual([5]);
  });

  it("weekly supplier that does, daily suppliers, no supplier: nothing skipped", () => {
    expect(standingDaysSupplierSkips([5], { orderFrequency: "weekly", orderDays: "Friday" })).toEqual([]);
    expect(standingDaysSupplierSkips([5], { orderFrequency: "daily", orderDays: null })).toEqual([]);
    expect(standingDaysSupplierSkips([5], null)).toEqual([]);
  });
});
