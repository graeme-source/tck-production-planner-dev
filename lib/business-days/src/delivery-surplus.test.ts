import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { calcExpectedDeliveryDate } from "./index";
import {
  surplusFor,
  surplusLabel,
  parseSurplusByDeliveryWeekday,
  isoWeekdayOf,
  orderToDeliveryWeekdays,
  deliverySurplusPreview,
  describeDeliverySurplus,
  unreachableDeliveryWeekdays,
} from "./delivery-surplus";

// Graeme's chicken: normal 30%, Mon/Tue/Wed deliveries 130%, Thu/Fri 30%.
const CHICKEN = {
  surplusMode: "percent",
  surplusPercent: "30.00",
  surplusAbsoluteQty: null,
  surplusByDeliveryWeekday: { 1: 130, 2: 130, 3: 130, 4: 30, 5: 30 },
};
const DAILY = 10; // kg a day

describe("order day → delivery day → surplus (1-day supplier, before cut-off)", () => {
  afterEach(() => vi.useRealTimers());

  // Week of Mon 12 Oct 2026. Order at 10:00 on each working day.
  const cases: Array<[string, Date, string, number]> = [
    ["Fri → Mon", new Date(2026, 9, 9, 10), "Mon", 130],
    ["Mon → Tue", new Date(2026, 9, 12, 10), "Tue", 130],
    ["Tue → Wed", new Date(2026, 9, 13, 10), "Wed", 130],
    ["Wed → Thu", new Date(2026, 9, 14, 10), "Thu", 30],
    ["Thu → Fri", new Date(2026, 9, 15, 10), "Fri", 30],
  ];
  for (const [name, orderAt, deliveryDay, pct] of cases) {
    it(name, () => {
      vi.useFakeTimers();
      vi.setSystemTime(orderAt);
      // The app's own delivery-date logic, exactly as the order engine calls it.
      const delivery = calcExpectedDeliveryDate(1, "17:00");
      const r = surplusFor(CHICKEN, delivery, DAILY);
      expect(surplusLabel(r)).toBe(`Surplus ${pct}% (delivery ${deliveryDay})`);
      expect(r.percent).toBe(pct);
      expect(r.qty).toBeCloseTo(DAILY * pct / 100);
      expect(r.fromDeliveryDay).toBe(true);
    });
  }

  it("past the cut-off the delivery slips a day and the surplus follows it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 13, 18)); // Tue 18:00, cut-off 17:00 → Thu
    const r = surplusFor(CHICKEN, calcExpectedDeliveryDate(1, "17:00"), DAILY);
    expect(r.deliveryWeekday).toBe(4);
    expect(r.percent).toBe(30);
  });
});

describe("blanks fall back to the normal surplus", () => {
  it("a day with no entry uses the ingredient's normal %", () => {
    const ing = { ...CHICKEN, surplusByDeliveryWeekday: { 1: 130 } };
    const r = surplusFor(ing, "2026-10-14", DAILY); // Wed
    expect(r.percent).toBe(30);
    expect(r.fromDeliveryDay).toBe(false);
    expect(surplusLabel(r)).toBe("Surplus 30%");
  });

  it("blank strings and nulls are ignored, 0 is a real setting", () => {
    expect(parseSurplusByDeliveryWeekday({ 1: "", 2: null, 3: "0", 4: " 45 ", 9: 50, x: 1, 5: -1, 6: "abc" }))
      .toEqual({ 3: 0, 4: 45 });
    expect(surplusFor({ ...CHICKEN, surplusByDeliveryWeekday: { 3: 0 } }, "2026-10-14", DAILY).qty).toBe(0);
  });

  it("an empty map means the feature is off", () => {
    expect(parseSurplusByDeliveryWeekday({})).toBeNull();
    expect(parseSurplusByDeliveryWeekday(null)).toBeNull();
    expect(parseSurplusByDeliveryWeekday([130])).toBeNull();
  });

  it("no delivery date → normal %", () => {
    const r = surplusFor(CHICKEN, null, DAILY);
    expect(r.percent).toBe(30);
    expect(r.deliveryWeekday).toBeNull();
  });
});

describe("regression: ingredients without the setting behave exactly as before", () => {
  // The old inline formula from routes/orders.ts.
  const legacy = (surplusPercent: unknown, mode: unknown, abs: unknown, daily: number) => {
    const pct = Number(surplusPercent) || 10;
    const m = mode === "absolute" ? "absolute" : "percent";
    const a = abs != null ? Number(abs) : null;
    return m === "absolute" ? Math.max(0, a ?? 0) : daily * (pct / 100);
  };
  const rows: Array<[unknown, unknown, unknown, number]> = [
    ["10.00", "percent", null, 9.54],
    ["210.00", "percent", null, 4],
    ["0", "percent", null, 5],       // 0 has always meant the 10% default
    [null, "percent", null, 5],
    ["10", "absolute", "4.5", 100],
    ["10", "absolute", null, 100],
    ["10", "absolute", "-3", 100],
  ];
  for (const [pct, mode, abs, daily] of rows) {
    it(`${mode} ${pct} / ${abs} / daily ${daily}`, () => {
      for (const date of [null, "2026-10-12", "2026-10-16", "2026-10-18"]) {
        expect(surplusFor({ surplusPercent: pct as any, surplusMode: mode as any, surplusAbsoluteQty: abs as any }, date, daily).qty)
          .toBeCloseTo(legacy(pct, mode, abs, daily));
      }
    });
  }

  it("absolute mode ignores delivery-day %", () => {
    const r = surplusFor({ ...CHICKEN, surplusMode: "absolute", surplusAbsoluteQty: "5" }, "2026-10-12", DAILY);
    expect(r.qty).toBe(5);
    expect(r.fromDeliveryDay).toBe(false);
    expect(surplusLabel(r)).toBe("Fixed surplus");
  });
});

describe("weekday + preview", () => {
  it("reads ISO date strings as calendar days", () => {
    expect(isoWeekdayOf("2026-10-12")).toBe(1);
    expect(isoWeekdayOf("2026-10-18")).toBe(7);
    expect(isoWeekdayOf(new Date(2026, 9, 18, 23, 30))).toBe(7);
  });

  it("maps order days to delivery days by lead time", () => {
    expect(orderToDeliveryWeekdays(1)).toEqual([
      { orderWeekday: 1, deliveryWeekday: 2 },
      { orderWeekday: 2, deliveryWeekday: 3 },
      { orderWeekday: 3, deliveryWeekday: 4 },
      { orderWeekday: 4, deliveryWeekday: 5 },
      { orderWeekday: 5, deliveryWeekday: 1 },
    ]);
    expect(orderToDeliveryWeekdays(2).find(r => r.orderWeekday === 5)?.deliveryWeekday).toBe(2);
    expect(unreachableDeliveryWeekdays(1)).toEqual([6, 7]);
  });

  it("writes Graeme's plain-English preview", () => {
    expect(describeDeliverySurplus(deliverySurplusPreview(CHICKEN, 1))).toBe(
      "Orders placed Fri → delivered Mon: 130% · Mon → Tue: 130% · Tue → Wed: 130% · Wed → Thu: 30% · Thu → Fri: 30%",
    );
  });
});

describe("suggestion quantity uses the delivery day's %", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Same shape as the order engine: required + surplus − stock, whole packs.
  const packs = (required: number, surplus: number, stock: number, packWeight: number) =>
    Math.ceil(Math.max(0, required + surplus - stock) / packWeight);

  it("Friday's order (Monday delivery) carries 130%, Wednesday's (Thursday) 30%", () => {
    vi.setSystemTime(new Date(2026, 9, 9, 10)); // Fri
    const fri = surplusFor(CHICKEN, calcExpectedDeliveryDate(1, "17:00"), 9.5);
    vi.setSystemTime(new Date(2026, 9, 14, 10)); // Wed
    const wed = surplusFor(CHICKEN, calcExpectedDeliveryDate(1, "17:00"), 9.5);
    // 9.5 needed, 4 kg on the shelf, 2.5 kg packs.
    expect(packs(9.5, fri.qty, 4, 2.5)).toBe(Math.ceil((9.5 + 12.35 - 4) / 2.5)); // 8
    expect(packs(9.5, wed.qty, 4, 2.5)).toBe(Math.ceil((9.5 + 2.85 - 4) / 2.5)); // 4
  });
});
