import { describe, it, expect } from "vitest";
import {
  londonWallTimeMs, orderCutoffMs, indexOrdersByDate, finalPacks, knownPacksAt,
  forecastLateOrders, combineLateForecasts, recipeSalesShares, addDays, despatchesBeforePlanEnd, type ForecastOrder,
} from "./late-orders";

const H = 3_600_000;

describe("London time", () => {
  it("handles BST and GMT", () => {
    expect(new Date(londonWallTimeMs("2026-10-15", "14:00")).toISOString()).toBe("2026-10-15T13:00:00.000Z");
    expect(new Date(londonWallTimeMs("2026-12-01", "14:00")).toISOString()).toBe("2026-12-01T14:00:00.000Z");
    // The day the clocks go back (25 Oct 2026): 14:00 is already GMT.
    expect(new Date(londonWallTimeMs("2026-10-25", "14:00")).toISOString()).toBe("2026-10-25T14:00:00.000Z");
  });

  it("closes a delivery day's orders at 2pm the day before (its despatch day)", () => {
    // Saturday 17 Oct delivery → Friday 16 Oct 14:00 BST.
    expect(new Date(orderCutoffMs("2026-10-17")).toISOString()).toBe("2026-10-16T13:00:00.000Z");
  });
});

describe("known and final packs", () => {
  const orders: ForecastOrder[] = [
    { createdAt: 0, cancelledAt: null, deliveryDate: "2026-10-17", packs: 4 },
    { createdAt: 10, cancelledAt: 50, deliveryDate: "2026-10-17", packs: 3 },
    { createdAt: 100, cancelledAt: null, deliveryDate: "2026-10-17", packs: 2 },
  ];
  it("a cancelled order is never final but counted as known until cancelled", () => {
    expect(finalPacks(orders)).toBe(6);
    expect(knownPacksAt(orders, 20)).toBe(7);
    expect(knownPacksAt(orders, 60)).toBe(4);
    expect(knownPacksAt(orders, 100)).toBe(6);
  });
});

/** `weeks` same-weekday delivery days before `target`, each with `early`
 *  packs ordered 100 h before its cut-off and `late` packs 10 h before. */
function history(target: string, weeks: number, early: number, late: number): ForecastOrder[] {
  const out: ForecastOrder[] = [];
  for (let w = 1; w <= weeks; w++) {
    const d = addDays(target, -7 * w);
    const cut = orderCutoffMs(d);
    out.push({ createdAt: cut - 100 * H, cancelledAt: null, deliveryDate: d, packs: early });
    out.push({ createdAt: cut - 10 * H, cancelledAt: null, deliveryDate: d, packs: late });
  }
  return out;
}

describe("forecastLateOrders", () => {
  const target = "2026-10-17";
  const cut = orderCutoffMs(target);
  const byDate = indexOrdersByDate(history(target, 8, 200, 100));

  it("share still to come × typical day: a third of 300 packs arrives in the last 48 h", () => {
    const f = forecastLateOrders({ byDate, deliveryDate: target, now: cut - 48 * H, emailsInWindow: 0, typicalEmailsPerHour: 0 });
    expect(f.closed).toBe(false);
    expect(f.shareStillToCome).toBeCloseTo(1 / 3, 6);
    expect(f.typicalDayPacks).toBe(300);
    expect(f.latePacks).toBe(100);
    expect(f.samples).toBe(8);
    expect(f.low).toBeLessThanOrEqual(100);
    expect(f.high).toBeGreaterThanOrEqual(100);
  });

  it("further out, more is still to come", () => {
    const f = forecastLateOrders({ byDate, deliveryDate: target, now: cut - 120 * H, emailsInWindow: 0, typicalEmailsPerHour: 0 });
    expect(f.latePacks).toBe(300);
  });

  it("adds the uplift only for emails beyond the usual number", () => {
    const usual = forecastLateOrders({ byDate, deliveryDate: target, now: cut - 48 * H, emailsInWindow: 1, typicalEmailsPerHour: 1 / 48 });
    expect(usual.latePacks).toBe(100);
    const extra = forecastLateOrders({ byDate, deliveryDate: target, now: cut - 48 * H, emailsInWindow: 3, typicalEmailsPerHour: 1 / 48 });
    expect(extra.emailAdjustment).toBe(40);
    expect(extra.latePacks).toBe(140);
  });

  it("nothing more once the cut-off has passed", () => {
    const f = forecastLateOrders({ byDate, deliveryDate: target, now: cut + H, emailsInWindow: 2, typicalEmailsPerHour: 0 });
    expect(f.closed).toBe(true);
    expect(f.latePacks).toBe(0);
  });

  it("too little history → no prediction (known orders only, as before)", () => {
    const thin = indexOrdersByDate(history(target, 3, 200, 100));
    const f = forecastLateOrders({ byDate: thin, deliveryDate: target, now: cut - 48 * H, emailsInWindow: 0, typicalEmailsPerHour: 0 });
    expect(f.latePacks).toBe(0);
    expect(f.samples).toBe(0);
  });

  it("only uses the same weekday, and never a day whose orders are still open", () => {
    const other = history(addDays(target, 1), 8, 50, 900); // Sundays, wildly different
    const open: ForecastOrder = { createdAt: cut - 200 * H, cancelledAt: null, deliveryDate: addDays(target, 7), packs: 5000 };
    const f = forecastLateOrders({ byDate: indexOrdersByDate([...history(target, 8, 200, 100), ...other, open]), deliveryDate: target, now: cut - 48 * H, emailsInWindow: 0, typicalEmailsPerHour: 0 });
    expect(f.latePacks).toBe(100);
  });
});

describe("despatchesBeforePlanEnd", () => {
  it("Thursday planning Monday: Thursday, Friday and Monday despatches", () => {
    expect(despatchesBeforePlanEnd({ today: "2026-10-15", planDate: "2026-10-19", dispatch1: "2026-10-16", todayIsDespatchDay: true }))
      .toEqual(["2026-10-15", "2026-10-16", "2026-10-19"]);
  });
  it("planning tomorrow: today is the despatch before it", () => {
    expect(despatchesBeforePlanEnd({ today: "2026-10-15", planDate: "2026-10-16", dispatch1: "2026-10-15", todayIsDespatchDay: true }))
      .toEqual(["2026-10-15", "2026-10-16"]);
  });
  it("planning on a Saturday for Monday: just Monday", () => {
    expect(despatchesBeforePlanEnd({ today: "2026-10-17", planDate: "2026-10-19", dispatch1: "2026-10-16", todayIsDespatchDay: false }))
      .toEqual(["2026-10-19"]);
  });
});

describe("combineLateForecasts", () => {
  it("adds expectations and ranges", () => {
    expect(combineLateForecasts([{ latePacks: 100, low: 70, high: 140 }, { latePacks: 50, low: 40, high: 60 }]))
      .toEqual({ latePacks: 150, low: 110, high: 200 });
  });
});

describe("recipeSalesShares", () => {
  it("shares of the last 7 days, cancelled and older lines ignored", () => {
    const now = 100 * 24 * H;
    const s = recipeSalesShares([
      { recipeId: 1, packs: 30, createdAt: now - 24 * H, cancelledAt: null },
      { recipeId: 2, packs: 10, createdAt: now - 48 * H, cancelledAt: null },
      { recipeId: 2, packs: 99, createdAt: now - 48 * H, cancelledAt: now },
      { recipeId: 3, packs: 99, createdAt: now - 8 * 24 * H, cancelledAt: null },
    ], now);
    expect(s).toEqual({ 1: 0.75, 2: 0.25 });
  });
});
