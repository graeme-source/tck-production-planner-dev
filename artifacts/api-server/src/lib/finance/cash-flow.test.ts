import { describe, it, expect } from "vitest";
import { forecastCashFlow, itemDates, shortError, type CfItem } from "./cash-flow";

const TODAY = "2026-10-26";
const item = (p: Partial<CfItem>): CfItem => ({ id: 1, label: "Capital on Tap", direction: "out", amount: 5000, onDate: null, everyDays: null, startsOn: null, endsOn: null, vendorName: null, active: true, ...p });

describe("cash-flow forecast (2026-10-26)", () => {
  it("every 4 days from a start date", () => {
    expect(itemDates(item({ everyDays: 4, startsOn: "2026-10-27" }), TODAY, "2026-11-08")).toEqual(["2026-10-27", "2026-10-31", "2026-11-04", "2026-11-08"]);
  });

  it("running balance: payouts in, bills and recurring outflows out, lowest point found", () => {
    const f = forecastCashFlow({
      today: TODAY, days: 7, balance: 20000, balanceAsOf: TODAY,
      bills: [
        { id: "b1", vendorName: "Brakes", docNumber: "INV-9", dueDate: "2026-10-28", balance: 3200 },
        { id: "b2", vendorName: "PIB Butchers", docNumber: null, dueDate: "2026-10-20", balance: 1800 },   // overdue → today, late
        { id: "b3", vendorName: "Packaging Co", docNumber: null, dueDate: "2026-12-01", balance: 999 },   // beyond the window
      ],
      payouts: [
        { id: "p1", date: "2026-10-27", status: "SCHEDULED", net: 6100 },
        { id: "p2", date: "2026-10-24", status: "PAID", net: 5000 },   // before the balance date: already in the bank
        { id: "p3", date: "2026-10-29", status: "FAILED", net: 4000 },
      ],
      items: [item({ everyDays: 4, startsOn: "2026-10-27" })],
    });
    expect(f.days).toHaveLength(7);
    const d0 = f.days[0];
    expect(d0.outs.map(o => [o.label, o.late])).toEqual([["PIB Butchers", true]]);
    expect(d0.closing).toBe(18200);
    expect(f.days[1].closing).toBe(18200 + 6100 - 5000);       // Tue: payout in, card out
    expect(f.days[2].closing).toBe(19300 - 3200);              // Wed: Brakes
    expect(f.days[5].closing).toBe(16100 - 5000);              // Sat 31st: card again
    expect(f.lowest).toEqual({ date: "2026-10-31", balance: 11100 });
    expect(f.totalIn).toBe(6100);
    expect(f.totalOut).toBe(1800 + 5000 + 3200 + 5000);
  });

  it("a bill with no due date lands today, marked undated; a stale unpaid payout lands today, late", () => {
    const f = forecastCashFlow({
      today: TODAY, days: 3, balance: 1000, balanceAsOf: "2026-10-20",
      bills: [{ id: "x", vendorName: "Mystery", docNumber: null, dueDate: null, balance: 50 }],
      payouts: [{ id: "q", date: "2026-10-23", status: "IN_TRANSIT", net: 700 }],
      items: [item({ onDate: "2026-10-22", amount: 100 })],  // between balance date and today: applied today
    });
    expect(f.days[0].outs.find(o => o.ref === "x")?.undated).toBe(true);
    expect(f.days[0].ins[0]).toMatchObject({ ref: "q", late: true });
    expect(f.days[0].closing).toBe(1000 + 700 - 50 - 100);
  });
});

describe("shortError (2026-10-26: the chip showed Shopify's whole error page)", () => {
  it("keeps just the reason from an HTML error page", () => {
    const html = 'Shopify token error 400: <!DOCTYPE html><html><head><title>400 - Oauth error invalid_request</title></head><body>…</body></html>';
    expect(shortError(html)).toBe("Oauth error invalid_request");
  });
  it("plain text is kept, long text is cut, nothing stays nothing", () => {
    expect(shortError("Couldn't reach Shopify")).toBe("Couldn't reach Shopify");
    expect(shortError("x".repeat(300))!.length).toBe(140);
    expect(shortError(null)).toBeNull();
  });
});
