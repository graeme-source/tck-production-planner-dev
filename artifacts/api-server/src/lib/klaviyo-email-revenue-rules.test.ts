import { describe, expect, it } from "vitest";
import { aggregateFilters, emailRevenueFromAggregates, nextDay } from "./klaviyo-email-revenue-rules";

// Real rows from Klaviyo for 2–8 Nov 2026 (Placed Order, grouped by
// $attributed_channel and $attributed_flow), trimmed to four flows.
const rows = [
  { dimensions: ["$email_channel", ""], measurements: { sum_value: [12789.569999999998], count: [216] } },
  { dimensions: ["$email_channel", "R58aKc"], measurements: { sum_value: [149.52], count: [1] } },
  { dimensions: ["$email_channel", "Ve4UFc"], measurements: { sum_value: [1150.29], count: [21] } },
  { dimensions: ["$email_channel", "XeSBLj"], measurements: { sum_value: [226.59000000000003], count: [3] } },
  { dimensions: ["$sms_channel", "Ab12Cd"], measurements: { sum_value: [99], count: [1] } },
];

describe("emailRevenueFromAggregates", () => {
  it("splits email revenue into campaigns (no flow) and flows", () => {
    const r = emailRevenueFromAggregates(rows);
    expect(r.campaigns).toEqual({ revenue: 12789.57, orders: 216 });
    expect(r.flows).toEqual({ revenue: 1526.4, orders: 25 });
    expect(r.revenue).toBe(14315.97);
    expect(r.orders).toBe(241);
  });

  it("lists flows biggest first and leaves SMS out", () => {
    const r = emailRevenueFromAggregates(rows);
    expect(r.byFlow.map(f => f.flowId)).toEqual(["Ve4UFc", "XeSBLj", "R58aKc"]);
  });

  it("adds up several interval buckets and ignores nulls", () => {
    const r = emailRevenueFromAggregates([
      { dimensions: ["$email_channel", null], measurements: { sum_value: [10, null, 5.5], count: [1, 0, 1] } },
    ]);
    expect(r.campaigns).toEqual({ revenue: 15.5, orders: 2 });
    expect(r.byFlow).toEqual([]);
  });

  it("is all zeros with nothing credited", () => {
    expect(emailRevenueFromAggregates([])).toMatchObject({ revenue: 0, orders: 0, byFlow: [] });
  });
});

describe("date filters", () => {
  it("makes the end exclusive, across a month end", () => {
    expect(nextDay("2026-11-30")).toBe("2026-12-01");
    expect(aggregateFilters("2026-11-02", "2026-11-08")).toEqual([
      "greater-or-equal(datetime,2026-11-02T00:00:00)",
      "less-than(datetime,2026-11-09T00:00:00)",
    ]);
  });
});
