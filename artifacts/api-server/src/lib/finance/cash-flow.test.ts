import { describe, it, expect } from "vitest";
import { forecastCashFlow, itemDates, shortError, staleOverrides, type CfItem } from "./cash-flow";

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

describe("rules and hand moves (2026-10-27: 'far too much shows overdue')", () => {
  const base = { today: TODAY, days: 14, balance: 10000, balanceAsOf: TODAY, payouts: [], items: [] };
  const abBill = { id: "ab1", vendorName: "AB Fruits", docNumber: null, txnDate: "2026-10-03", dueDate: "2026-10-03", balance: 400 };

  it("a supplier rule moves an 'overdue' bill to the day it's really paid, and says so", () => {
    const without = forecastCashFlow({ ...base, bills: [abBill] });
    expect(without.days[0].outs[0]).toMatchObject({ late: true, date: "2026-10-03" });
    const f = forecastCashFlow({ ...base, bills: [abBill], rules: [{ vendorName: "a.b. fruits", rule: { kind: "next_month_day_cutoff", day: 1, cutoff: 15 } }] });
    expect(f.days[0].outs).toHaveLength(0);
    const nov1 = f.days.find(d => d.date === "2026-11-01")!;
    expect(nov1.outs[0]).toMatchObject({ late: false, date: "2026-11-01", naturalDate: "2026-11-01" });
    expect(nov1.outs[0].bill).toMatchObject({ basis: "rule", qboDueDate: "2026-10-03", txnDate: "2026-10-03", ruleDate: "2026-11-01" });
    expect(nov1.outs[0].bill!.ruleText).toContain("15th");
  });

  it("a hand move beats the rule, remembers where it came from, and moves the balance", () => {
    const f = forecastCashFlow({
      ...base, bills: [abBill],
      rules: [{ vendorName: "AB Fruits", rule: { kind: "next_month_day", day: 1 } }],
      overrides: [{ source: "bill", ref: "ab1", occurrence: "", plannedDate: "2026-11-05" }],
    });
    const line = f.days.find(d => d.date === "2026-11-05")!.outs[0];
    expect(line).toMatchObject({ movedFrom: "2026-11-01", date: "2026-11-05", key: "bill:ab1:" });
    expect(line.bill!.basis).toBe("override");
    expect(f.days.find(d => d.date === "2026-11-04")!.closing).toBe(10000);
    expect(f.days.find(d => d.date === "2026-11-05")!.closing).toBe(9600);
  });

  it("a move past the window drops the line out; a move into it from beyond brings it in", () => {
    const later = forecastCashFlow({ ...base, bills: [abBill], overrides: [{ source: "bill", ref: "ab1", occurrence: "", plannedDate: "2027-01-10" }] });
    expect(later.totalOut).toBe(0);
    const farBill = { ...abBill, id: "far", dueDate: "2026-12-20" };
    const sooner = forecastCashFlow({ ...base, bills: [farBill], overrides: [{ source: "bill", ref: "far", occurrence: "", plannedDate: "2026-10-30" }] });
    expect(sooner.days.find(d => d.date === "2026-10-30")!.outs[0]).toMatchObject({ ref: "far", movedFrom: "2026-12-20" });
  });

  it("no due date in QuickBooks: the bill date is used, flagged", () => {
    const f = forecastCashFlow({ ...base, bills: [{ ...abBill, dueDate: null, txnDate: "2026-10-28" }] });
    expect(f.days.find(d => d.date === "2026-10-28")!.outs[0]).toMatchObject({ undated: true, late: false });
    expect(f.days.find(d => d.date === "2026-10-28")!.outs[0].bill!.basis).toBe("bill_date");
  });

  it("payouts and single occurrences of a repeating item move on their own", () => {
    const f = forecastCashFlow({
      ...base,
      bills: [],
      payouts: [{ id: "p1", date: "2026-10-27", status: "SCHEDULED", net: 3000 }],
      items: [item({ id: 7, everyDays: 4, startsOn: "2026-10-27" })],
      overrides: [
        { source: "payout", ref: "p1", occurrence: "", plannedDate: "2026-10-29" },
        { source: "item", ref: "7", occurrence: "2026-10-31", plannedDate: "2026-11-02" },
        // An occurrence from beyond the 14-day window pulled into it.
        { source: "item", ref: "7", occurrence: "2026-11-12", plannedDate: "2026-11-08" },
      ],
    });
    const on = (d: string) => f.days.find(x => x.date === d)!;
    expect(on("2026-10-27").ins).toHaveLength(0);
    expect(on("2026-10-29").ins[0]).toMatchObject({ ref: "p1", movedFrom: "2026-10-27" });
    expect(on("2026-10-31").outs).toHaveLength(0);
    expect(on("2026-11-02").outs[0]).toMatchObject({ key: "item:7:2026-10-31", movedFrom: "2026-10-31" });
    expect(on("2026-11-04").outs[0]).toMatchObject({ key: "item:7:2026-11-04" });
    expect(on("2026-11-08").outs.map(l => l.key).sort()).toEqual(["item:7:2026-11-08", "item:7:2026-11-12"]);
  });

  it("drops moves for paid bills and finished payouts — but never when a source didn't load", () => {
    const o = [
      { source: "bill" as const, ref: "paid", occurrence: "", plannedDate: "2026-11-01" },
      { source: "bill" as const, ref: "open", occurrence: "", plannedDate: "2026-11-01" },
      { source: "payout" as const, ref: "p-paid", occurrence: "", plannedDate: "2026-11-01" },
      { source: "payout" as const, ref: "p-sched", occurrence: "", plannedDate: "2026-11-01" },
      { source: "item" as const, ref: "1", occurrence: "2026-10-30", plannedDate: "2026-11-01" },
    ];
    const stale = staleOverrides(o, { bills: [{ id: "open" }], payouts: [{ id: "p-paid", status: "PAID" }, { id: "p-sched", status: "SCHEDULED" }] });
    expect(stale.map(s => s.ref)).toEqual(["paid", "p-paid"]);
    expect(staleOverrides(o, { bills: null, payouts: null })).toEqual([]);
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
