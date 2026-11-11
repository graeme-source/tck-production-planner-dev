import { describe, it, expect } from "vitest";
import { firstDeliveryAfterWeekend, parseZapietDisabled } from "./next-delivery-after-weekend";

const cal = (over: Partial<{ disabledWeekdays: number[]; blockedDates: string[]; nonDispatchDates: string[] }> = {}) => ({
  disabledWeekdays: new Set(over.disabledWeekdays ?? [0, 1]),
  blockedDates: new Set(over.blockedDates ?? []),
  nonDispatchDates: new Set(over.nonDispatchDates ?? []),
});

describe("first delivery after a missed Saturday", () => {
  it("is Tuesday (Monday's dispatch) in a normal week", () => {
    expect(firstDeliveryAfterWeekend("2026-11-14", cal())).toEqual({ delivery: "2026-11-17", dispatch: "2026-11-16" });
  });
  it("after a bank-holiday Monday (our closure) it's Wednesday", () => {
    expect(firstDeliveryAfterWeekend("2026-12-26", cal({ nonDispatchDates: ["2026-12-28"] }))).toEqual({ delivery: "2026-12-30", dispatch: "2026-12-29" });
  });
  it("a Tuesday blacked out in Zapiet pushes to the next open day", () => {
    expect(firstDeliveryAfterWeekend("2026-11-14", cal({ blockedDates: ["2026-11-17"] }))?.delivery).toBe("2026-11-18");
  });
  it("a closed Tuesday blocks both Tuesday's delivery and Wednesday's (no dispatch that day)", () => {
    expect(firstDeliveryAfterWeekend("2026-11-14", cal({ nonDispatchDates: ["2026-11-17"] }))).toEqual({ delivery: "2026-11-19", dispatch: "2026-11-18" });
  });
  it("never a Saturday or Monday", () => {
    const r = firstDeliveryAfterWeekend("2026-11-14", cal({ disabledWeekdays: [], blockedDates: ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"] }));
    expect(r?.delivery).toBe("2026-11-24");
  });
});

describe("parseZapietDisabled", () => {
  it("reads weekdays 1 = Sunday (Zapiet's live answer [1, 2] is Sunday and Monday, 11 Nov 2026)", () => {
    const p = parseZapietDisabled([1, 2, [2026, 11, 25], [2026, 0, 1], "x"]);
    expect([...p.weekdays]).toEqual([0, 1]);
    expect([...p.dates]).toEqual(["2026-12-25", "2026-01-01"]);
    expect(p.allowList).toBe(false);
  });
  it("with Zapiet's live calendar a missed Saturday 14 Nov goes to Tuesday 17", () => {
    const p = parseZapietDisabled([1, 2, [2026, 10, 22], [2026, 11, 4], [2026, 11, 24], [2026, 11, 25], [2026, 11, 26], [2027, 0, 1]]);
    const c = { disabledWeekdays: p.weekdays, blockedDates: p.dates, nonDispatchDates: new Set(["2026-12-25", "2026-12-28", "2027-01-01"]) };
    expect(firstDeliveryAfterWeekend("2026-11-14", c)?.delivery).toBe("2026-11-17");
    // Boxing Day Saturday: Monday 28 Dec closed, so Wednesday 30.
    expect(firstDeliveryAfterWeekend("2026-12-26", c)?.delivery).toBe("2026-12-30");
  });
  it("allow-list mode: only the listed dates are open", () => {
    const p = parseZapietDisabled([true, [2026, 10, 19]]);
    expect(p.allowList).toBe(true);
    const c = { disabledWeekdays: new Set<number>(), blockedDates: new Set<string>(), allowedDates: p.dates, nonDispatchDates: new Set<string>() };
    expect(firstDeliveryAfterWeekend("2026-11-14", c)?.delivery).toBe("2026-11-19");
  });
});
