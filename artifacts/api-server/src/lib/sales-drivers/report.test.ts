import { describe, it, expect } from "vitest";
import { addDays, weekdayOf, mulberry32 } from "./analysis";
import { toDayFacts, buildFindings, withImpacts, contextNotes, describeComparison, type DailyRow, type ChangeRow } from "./report";

function rows(n: number, opts: { penalty: number; seed?: number; slowFrom?: string } = { penalty: 0.3 }): DailyRow[] {
  const rnd = mulberry32(opts.seed ?? 3);
  const base = [0.03, 0.045, 0.045, 0.045, 0.045, 0.04, 0.03];
  const usual = [2, 1, 1, 1, 1, 1, 3];
  const out: DailyRow[] = [];
  let day = "2026-06-07"; // Sunday
  for (let i = 0; i < n; i++) {
    const w = weekdayOf(day);
    const slow = opts.slowFrom ? day >= opts.slowFrom : i % 3 === 0;
    const lead = usual[w] + (slow ? 5 : 0);
    const rate = base[w] * (slow ? 1 - opts.penalty : 1) * (1 + (rnd() - 0.5) * 0.2);
    out.push({
      day, sessions: 1000, conversionRate: rate, orders: Math.round(rate * 1000), newCustomerOrders: 10, revenue: 500,
      leadDays: lead, nextDayAvailable: lead === 1, leadSource: "zapiet_1pm", sampleOrders: null,
    });
    day = addDays(day, 1);
  }
  return out;
}

describe("toDayFacts", () => {
  it("uses Shopify's rate × sessions, and drops one-order lead estimates", () => {
    const f = toDayFacts([
      { day: "2026-10-13", sessions: 800, conversionRate: 0.04, orders: 99, newCustomerOrders: 1, revenue: 1, leadDays: 1, nextDayAvailable: true, leadSource: "orders_estimate", sampleOrders: 1 },
      { day: "2026-10-14", sessions: 800, conversionRate: 0.04, orders: 99, newCustomerOrders: 1, revenue: 1, leadDays: 2, nextDayAvailable: false, leadSource: "orders_estimate", sampleOrders: 5 },
    ]);
    expect(f[0]).toEqual({ day: "2026-10-13", sessions: 800, orders: 32, leadDays: null });
    expect(f[1].leadDays).toBe(2);
  });
});

describe("buildFindings", () => {
  it("states the lead-time finding as a likelihood with its evidence", () => {
    const f = buildFindings(rows(91, { penalty: 0.3 }));
    expect(f.lead[0].sentence).toMatch(/very likely lower — about \d+%/);
    expect(f.lead[0].sentence).toMatch(/Based on \d+ days vs \d+/);
    expect(f.lead[0].sentence).not.toMatch(/caused|because|proves/i);
    expect(f.exactLeadDays).toBe(91);
    expect(f.weekendNote).toMatch(/can't be separated/);
  });

  it("says when there isn't enough data", () => {
    const f = buildFindings(rows(5));
    expect(f.lead[0].sentence).toMatch(/not enough days yet/);
  });
});

describe("describeComparison", () => {
  it("reports no clear difference honestly", () => {
    const s = describeComparison(
      { effect: 0.01, low: -0.05, high: 0.07, probabilityLower: 0.45, exposedDays: 10, comparisonDays: 30, exposedRate: 0.04, comparisonRate: 0.04, enoughData: true },
      "Test",
    );
    expect(s).toMatch(/no clear difference/);
  });
});

describe("withImpacts", () => {
  it("attaches a before/after likelihood to a change, with any lead-time shift", () => {
    const data = rows(60, { penalty: 0.3, slowFrom: "2026-07-07" });
    const change: ChangeRow = { id: 1, effectiveAt: "2026-07-06T10:00:00Z", category: "offer", title: "Free pack wording", detail: null, source: "theme" };
    const [c] = withImpacts([change], data);
    expect(c.impact?.likelihood).toBe("very likely lower");
    expect(c.impact?.leadShift).toBeCloseTo(5, 0);
  });
});

describe("contextNotes", () => {
  it("flags a slow week, emails and site changes for the spend advice", () => {
    const data = rows(91, { penalty: 0.3 });
    const last = data[data.length - 1].day;
    const from = addDays(last, -6);
    const findings = buildFindings(data);
    const notes = contextNotes(data, [
      { id: 1, effectiveAt: `${from}T09:00:00Z`, category: "email", title: "Email: Autumn", detail: null, source: "klaviyo" },
      { id: 2, effectiveAt: `${last}T09:00:00Z`, category: "offer", title: "Announcement: ends Friday", detail: null, source: "theme" },
    ], from, last, findings);
    expect(notes[0]).toMatch(/Delivery wait was longer than usual on \d of the 7 days/);
    expect(notes[0]).toMatch(/may be the wait rather than the ads/);
    expect(notes.some(n => /1 email sent/.test(n))).toBe(true);
    expect(notes.some(n => /Announcement: ends Friday/.test(n))).toBe(true);
  });

  it("says nothing when nothing unusual happened", () => {
    const data = rows(91, { penalty: 0.3 }).map(r => ({ ...r, leadDays: [2, 1, 1, 1, 1, 1, 3][weekdayOf(r.day)] }));
    const last = data[data.length - 1].day;
    expect(contextNotes(data, [], addDays(last, -6), last, buildFindings(data))).toEqual([]);
  });
});
