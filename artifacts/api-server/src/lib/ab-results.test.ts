import { describe, it, expect } from "vitest";
import { chanceBetter, computeAbResults, normalCdf, orderThemeId, type AbOrder } from "./ab-results";

const FROM = new Date("2026-10-24T06:30:00Z");
const TO = new Date("2026-10-30T00:00:00Z");
const order = (theme: number | null, total: string, tags = "", extra: Partial<AbOrder> = {}): AbOrder => ({
  created_at: "2026-10-25T12:00:00Z", cancelled_at: null, financial_status: "paid", total_price: total, refunds: [], tags,
  note_attributes: theme == null ? [] : [{ name: "_tck_ab_theme", value: String(theme) }], ...extra,
} as AbOrder);
const VARIANTS = [
  { label: "Control", themeId: 1, themeName: "main", split: 50 },
  { label: "Treatment", themeId: 2, themeName: "upf-free-test", split: 50 },
];

describe("website A/B results", () => {
  it("reads the theme stamp", () => {
    expect(orderThemeId(order(201516974454, "1"))).toBe(201516974454);
    expect(orderThemeId(order(null, "1"))).toBeNull();
  });

  it("revenue, revenue per session, conversion and new subscriptions per theme", () => {
    const r = computeAbResults({
      variants: VARIANTS,
      hits: new Map([[1, { visits: 100, addToCart: 20 }], [2, { visits: 100, addToCart: 30 }]]),
      orders: [
        order(1, "50.00"), order(1, "30.00", "new-customer"),
        order(2, "60.00", "Subscription New Order, new-customer"), order(2, "40.00"), order(2, "20.00"),
        order(2, "99.00", "Subscription Recurring Order"),            // renewal: not won by a theme
        order(2, "99.00", "", { cancelled_at: "2026-10-25T13:00:00Z" }), // cancelled
        order(1, "10.00", "", { created_at: "2026-10-20T12:00:00Z" }),    // before the test
        order(null, "25.00"),                                              // no stamp
      ],
      from: FROM, to: TO,
    });
    const [c, t] = r.variants;
    expect(c).toMatchObject({ sessions: 100, orders: 2, revenue: 80, revenuePerSession: 0.8, averageOrderValue: 40, addToCartRate: 0.2, newCustomers: 1, newSubscriptions: 0, vsControl: null });
    expect(t).toMatchObject({ orders: 3, revenue: 120, revenuePerSession: 1.2, conversionRate: 0.03, newSubscriptions: 1 });
    expect(t.vsControl?.revenuePerSessionLift).toBeCloseTo(0.5);
    expect(t.vsControl?.conversionLift).toBeCloseTo(0.5);
    expect(r.untaggedOrders).toBe(1);
  });

  it("chance better: 50% for a tie, high for a clear win, null without data", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(chanceBetter({ mean: 0.02, variance: 0.0196, n: 5000 }, { mean: 0.02, variance: 0.0196, n: 5000 })).toBeCloseTo(0.5);
    expect(chanceBetter({ mean: 0.02, variance: 0.0196, n: 5000 }, { mean: 0.03, variance: 0.0291, n: 5000 })!).toBeGreaterThan(0.99);
    expect(chanceBetter({ mean: 0, variance: 0, n: 0 }, { mean: 1, variance: 0, n: 0 })).toBeNull();
  });
});
