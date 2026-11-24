import { describe, it, expect } from "vitest";
import { dailyUse, daysOfStockLeft, kanbanLeftQty, orderByDate, stockLeftLabel, supplierOrderWeekdays } from "./kanban-stock-left";

describe("kanbanLeftQty", () => {
  it("takes the safety stock, less the pack they've started", () => {
    expect(kanbanLeftQty({ kanbanQuantity: 3, kanbanUnit: "pack", packWeight: 2.5 })).toBe(5);       // 3 × 2.5 kg − 2.5
    expect(kanbanLeftQty({ kanbanQuantity: 6, kanbanUnit: "bottle", packWeight: 1 })).toBe(5);
    // A "weight" card holds a pack count on the live cards: 6 × 450 g − one pack.
    expect(kanbanLeftQty({ kanbanQuantity: 6, kanbanUnit: "weight", packWeight: 450 })).toBe(2250);
    // In the item's own unit the card's figure is what's left: pull at 1,000 leaflets
    expect(kanbanLeftQty({ kanbanQuantity: 1000, kanbanUnit: "unit", packWeight: 10000 })).toBe(1000);
    expect(kanbanLeftQty({ kanbanQuantity: 1, kanbanUnit: "pallet", packWeight: 1, palletSize: 720 })).toBe(719);
  });
  it("never goes below nothing, and says nothing without a safety stock", () => {
    expect(kanbanLeftQty({ kanbanQuantity: 1, kanbanUnit: "pack", packWeight: 2 })).toBe(0);
    expect(kanbanLeftQty({ kanbanQuantity: 0, kanbanUnit: "pack", packWeight: 2 })).toBeNull();
    expect(kanbanLeftQty({ kanbanQuantity: 2, kanbanUnit: "pack", packWeight: 0 })).toBeNull();
  });
});

describe("dailyUse", () => {
  const now = Date.UTC(2026, 10, 19);
  const day = 86_400_000;
  it("uses recorded usage where it's tracked", () => {
    const usage = Array.from({ length: 30 }, (_, k) => ({ at: now - (k + 1) * day, qty: 2 }));
    const r = dailyUse({ receipts: [], usage, coverage: "tracked", nowMs: now });
    expect(r?.basis).toBe("usage");
    expect(r!.perDay).toBeCloseTo(2, 5);
  });
  it("otherwise works it out from deliveries, leaving out the last one (still on the shelf)", () => {
    const receipts = [{ at: now - 60 * day, qty: 30 }, { at: now - 30 * day, qty: 30 }, { at: now - 2 * day, qty: 30 }];
    const r = dailyUse({ receipts, usage: [], coverage: "untracked", nowMs: now });
    expect(r?.basis).toBe("deliveries");
    expect(r!.perDay).toBeCloseTo(60 / 58, 5);
  });
  it("won't guess from one delivery or under a fortnight", () => {
    expect(dailyUse({ receipts: [{ at: now - 40 * day, qty: 10 }], usage: [], coverage: "untracked", nowMs: now })).toBeNull();
    expect(dailyUse({ receipts: [{ at: now - 10 * day, qty: 10 }, { at: now - 2 * day, qty: 10 }], usage: [], coverage: "untracked", nowMs: now })).toBeNull();
  });
});

describe("daysOfStockLeft and stockLeftLabel", () => {
  it("reads like someone deciding whether to wait", () => {
    expect(daysOfStockLeft(21, 1)).toBe(21);
    expect(daysOfStockLeft(5, null)).toBeNull();
    expect(stockLeftLabel(0)).toBe("Less than a day left");
    expect(stockLeftLabel(9)).toBe("About 9 days left");
    expect(stockLeftLabel(21)).toBe("About 3 weeks left");
    expect(stockLeftLabel(95)).toBe("About 3 months left");
  });
});

describe("orderByDate", () => {
  // Thursday 19 Nov 2026, 10:00.
  const base = { today: "2026-11-19", nowMinute: 600, cutoff: "16:00" };
  it("works back from the run-out day through a weekly supplier's order day", () => {
    // A Tuesday-only supplier, 2-day lead time, 3 weeks left (runs out Thu 10 Dec).
    const r = orderByDate({ ...base, leadTimeDays: 2, orderWeekdays: new Set([2]), daysLeft: 21 });
    expect(r.runsOutOn).toBe("2026-12-10");
    expect(r.orderBy).toBe("2026-12-08");        // Tue 8 Dec → delivered Thu 10 Dec
    expect(r.nextOrderDay).toBe("2026-11-24");
    expect(r.urgency).toBe("plenty");
  });
  it("says it's the last chance when the next order day is the last one", () => {
    const r = orderByDate({ ...base, leadTimeDays: 2, orderWeekdays: new Set([2]), daysLeft: 8 });   // runs out Fri 27 Nov
    expect(r.orderBy).toBe("2026-11-24");
    expect(r.urgency).toBe("last_chance");
  });
  it("can't be put off when today is the last day that arrives in time", () => {
    const r = orderByDate({ ...base, leadTimeDays: 1, orderWeekdays: null, daysLeft: 1 });   // runs out Fri, delivered Fri
    expect(r.orderBy).toBe("2026-11-19");
    expect(r.urgency).toBe("today");
  });
  it("is too late after the cutoff, or when nothing would arrive in time", () => {
    expect(orderByDate({ ...base, nowMinute: 17 * 60, leadTimeDays: 1, orderWeekdays: null, daysLeft: 1 }).urgency).toBe("now");
    expect(orderByDate({ ...base, leadTimeDays: 5, orderWeekdays: null, daysLeft: 2 }).orderBy).toBeNull();
  });
  it("lead times skip the weekend", () => {
    // Order Fri 20 Nov with a 1-day lead → Mon 23 Nov; runs out Mon 23 Nov.
    expect(orderByDate({ ...base, leadTimeDays: 1, orderWeekdays: null, daysLeft: 4 }).orderBy).toBe("2026-11-20");
  });
});

describe("supplierOrderWeekdays", () => {
  it("limits only weekly suppliers with days set", () => {
    expect([...supplierOrderWeekdays("weekly", "Monday,Thursday")!]).toEqual([1, 4]);
    expect(supplierOrderWeekdays("daily", "Monday")).toBeNull();
    expect(supplierOrderWeekdays("weekly", "")).toBeNull();
  });
});
