import { describe, it, expect } from "vitest";
import {
  isDigitalOnlyOrder, manualUnitCosting, pickVariantCosting, supplyUnitCosting,
  accountKey, boxSizeFor, bucketTotals, byProduct, bySize, calibrate, compareMonth, costOrder, orderRows, periodPnl,
  resolveBuckets, type Bucket, type Calibration, type CostRates, type TrackerOrder, type VariantCosting,
} from "./profit-tracker";
import type { PnlLine } from "./qbo-pnl-by-month";

const line = (name: string, group: string, depth: number, amounts: number[], children: PnlLine[] = [], kind: PnlLine["kind"] = children.length ? "section" : "account"): PnlLine =>
  ({ key: `${group}/${name}`, name, accountId: null, depth, kind, group, amounts, total: amounts.reduce((s, n) => s + n, 0), children });

// A cut-down QuickBooks P&L, two months.
const report: PnlLine[] = [
  line("Income", "Income", 0, [1000, 1200], [line("TCK Delivered Gross Sales", "Income", 1, [1000, 1200])]),
  line("Cost of Sales", "COGS", 0, [520, 610], [
    line("Cost of TCK Delivered", "COGS", 1, [420, 500], [
      line("Cost of TCK Delivered", "COGS", 2, [10, 0]), // the parent's own postings
      line("Courier Services - TCKD", "COGS", 2, [100, 120]),
      line("Food Purchases  TCK Delivered", "COGS", 2, [250, 300], [line("Meat", "COGS", 3, [250, 300])]),
      line("Packaging - COS -TCKD", "COGS", 2, [40, 50]),
      line("Shopify Fees", "COGS", 2, [20, 30]),
    ]),
    line("Direct Wages Cost", "COGS", 1, [100, 110], [line("Productive Hours Cost", "COGS", 2, [100, 110])]),
  ]),
  line("Gross Profit", "GrossProfit", 0, [480, 590], [], "total"),
  line("Expenses", "Expenses", 0, [400, 420], [
    line("Advertising and Promotion", "Expenses", 1, [150, 170]),
    line("Rent", "Expenses", 1, [250, 250]),
  ]),
  line("Other Income", "OtherIncome", 0, [5, 5], [line("Other Income", "OtherIncome", 1, [5, 5])]),
  line("Other Expenses", "OtherExpenses", 0, [30, 30], [line("Depreciation Expense", "OtherExpenses", 1, [30, 30])]),
];

const chosen = new Map<string, Bucket>([
  ["cost of tck delivered", "food"],
  ["food purchases tck delivered", "food"],
  ["packaging - cos -tckd", "packaging"],
  ["courier services - tckd", "courier"],
  ["shopify fees", "payment_fees"],
  ["direct wages cost", "production_labour"],
  ["advertising and promotion", "advertising"],
]);

describe("account buckets", () => {
  const accounts = resolveBuckets(report, chosen);
  const of = (name: string) => accounts.filter(a => a.name === name);

  it("matches names ignoring case and spacing", () => {
    expect(accountKey("Food Purchases  TCK Delivered")).toBe("food purchases tck delivered");
  });

  it("gives sub-accounts their parent's bucket unless they have their own", () => {
    expect(of("Meat")[0]).toMatchObject({ bucket: "food", source: "inherited" });
    expect(of("Courier Services - TCKD")[0]).toMatchObject({ bucket: "courier", source: "set" });
    expect(of("Productive Hours Cost")[0]).toMatchObject({ bucket: "production_labour", source: "inherited" });
  });

  it("falls back to the P&L group, marked as a default", () => {
    expect(of("Rent")[0]).toMatchObject({ bucket: "overhead", source: "default" });
    expect(of("TCK Delivered Gross Sales")[0]).toMatchObject({ bucket: "income", source: "default" });
    expect(of("Depreciation Expense")[0]).toMatchObject({ bucket: "below_line", source: "default" });
  });

  it("adds up to QuickBooks' own lines, other income reducing below-the-line", () => {
    const t = bucketTotals(accounts, 2);
    expect(t.income).toEqual([1000, 1200]);
    expect(t.food).toEqual([260, 300]); // own postings + meat
    expect(t.courier).toEqual([100, 120]);
    expect(t.packaging).toEqual([40, 50]);
    expect(t.payment_fees).toEqual([20, 30]);
    expect(t.production_labour).toEqual([100, 110]);
    expect(t.advertising).toEqual([150, 170]);
    expect(t.overhead).toEqual([250, 250]);
    expect(t.below_line).toEqual([25, 25]);
    // Gross profit matches QuickBooks.
    const cos = [0, 1].map(i => t.food[i]! + t.courier[i]! + t.packaging[i]! + t.payment_fees[i]! + t.production_labour[i]!);
    expect([1000 - cos[0]!, 1200 - cos[1]!]).toEqual([480, 590]);
  });

  it("calibrates from the months' averages", () => {
    const c = calibrate(bucketTotals(accounts, 2), ["2026-09", "2026-10"]);
    expect(c).toMatchObject({ overheadMonthly: 250, belowLineMonthly: 25, otherCostOfSalesMonthly: 0 });
    expect(c.paymentFeeRate).toBeCloseTo(50 / 2200);
    expect(c.labourRate).toBeCloseTo(210 / 2200);
  });
});

describe("box size", () => {
  it("follows the box tags, then the weight", () => {
    expect(boxSizeFor("2026-11-20, Small Box", 9000, 7001)).toBe("small");
    expect(boxSizeFor("Large Box", 1000, 7001)).toBe("large");
    expect(boxSizeFor("wholesale", 1000, 7001)).toBe("large");
    expect(boxSizeFor("", 7001, 7001)).toBe("large");
    expect(boxSizeFor("", 5000, 7001)).toBe("small");
    expect(boxSizeFor("gift card", 0, 7001)).toBe("none");
  });
});

const rates: CostRates = { smallBox: 2.5, largeBox: 3.5, smallCourier: 4.72, largeCourier: 5.72, weightThresholdGrams: 7001, paymentFeeRate: 0.02 };
const costing = new Map<string, VariantCosting>([
  ["v1", { name: "Pepperoni", food: 3, packaging: 0.4, isPack: true }],
  ["v2", { name: "Chicken Tikka", food: 4, packaging: 0.4, isPack: true }],
  ["mayo", { name: "Garlic Mayo", food: 0.5, packaging: 0, isPack: false }],
]);
const londonDay = (iso: string) => iso.slice(0, 10);
const order = (over: Partial<TrackerOrder>): TrackerOrder => ({
  id: 1, name: "#1", createdAt: "2026-11-10T10:00:00Z", cancelledAt: null, tags: "Small Box",
  totalPrice: 60, subtotalPrice: 53.05, totalTax: 0, totalDiscounts: 10, totalWeight: 5000, refunded: 0,
  lines: [
    { variantId: "v1", title: "Pepperoni", variantTitle: null, quantity: 3, price: 15, discount: 6 },
    { variantId: "v2", title: "Chicken Tikka", variantTitle: null, quantity: 1, price: 16, discount: 4 },
  ],
  ...over,
});

describe("costOrder", () => {
  it("costs food and packaging per item, the box and courier per order, fees on the total", () => {
    const e = costOrder(order({}), costing, rates, londonDay);
    expect(e).toMatchObject({
      box: "small", usesCourier: true, packs: 4, items: 4,
      revenue: 60, shippingCharged: 6.95, discounts: 10,
      food: 13,                 // 3×3 + 4
      packaging: 4.1,           // 4×0.40 trays + 2.50 box
      productCost: 14.6,        // food 13 + 4×0.40 trays
      boxCost: 2.5,
      courier: 4.72,
      paymentFees: 1.2,
      orderProfit: 36.98,       // 60 − 13 − 4.10 − 4.72 − 1.20
      uncostedItems: 0,
    });
  });

  it("marks which products have no cost", () => {
    const e = costOrder(order({ lines: [
      { variantId: "v1", title: "Pepperoni", variantTitle: null, quantity: 2, price: 15, discount: 0 },
      { variantId: "nope", title: "Mystery Sauce", variantTitle: null, quantity: 1, price: 2, discount: 0 },
    ] }), costing, rates, londonDay);
    expect(e.uncostedItems).toBe(1);
    expect(e.products).toEqual([
      { name: "Pepperoni", quantity: 2, costed: true, variantId: "v1", title: "Pepperoni" },
      { name: "Mystery Sauce", quantity: 1, costed: false, variantId: "nope", title: "Mystery Sauce" },
    ]);
  });

  it("each uncosted Shopify variant is its own row with its id, so it can be given a cost (25 Nov 2026)", () => {
    const e = costOrder(order({ lines: [
      { variantId: "s1", title: "Hot Sauce", variantTitle: "Small", quantity: 1, price: 2, discount: 0 },
      { variantId: "s2", title: "Hot Sauce", variantTitle: "Large", quantity: 2, price: 3, discount: 0 },
      { variantId: "s1", title: "Hot Sauce", variantTitle: "Small", quantity: 1, price: 2, discount: 0 },
      { variantId: "d1", title: "Dip", variantTitle: "Default Title", quantity: 1, price: 1, discount: 0 },
      { variantId: null, title: "Custom item", variantTitle: null, quantity: 1, price: 1, discount: 0 },
    ] }), costing, rates, londonDay);
    expect(e.uncostedItems).toBe(6);
    expect(e.products).toEqual([
      { name: "Hot Sauce – Large", quantity: 2, costed: false, variantId: "s2", title: "Hot Sauce – Large" },
      { name: "Hot Sauce – Small", quantity: 2, costed: false, variantId: "s1", title: "Hot Sauce – Small" },
      { name: "Custom item", quantity: 1, costed: false, variantId: null, title: "Custom item" },
      { name: "Dip", quantity: 1, costed: false, variantId: "d1", title: "Dip" },
    ]);
  });

  it("a digital-only order (membership, gift card) needs no box or courier and isn't flagged — even tagged Small Box (#140566, 25 Nov 2026)", () => {
    const e = costOrder(order({
      tags: "2026-12-02, Small Box, Subscription Recurring Order", totalWeight: 0, totalPrice: 25, subtotalPrice: 25, totalTax: 4.17, totalDiscounts: 0,
      lines: [{ variantId: "club", title: "Calzone Club Membership", variantTitle: null, quantity: 1, price: 25, discount: 0, requiresShipping: false, giftCard: false }],
    }), costing, rates, londonDay);
    expect(e).toMatchObject({ box: "none", usesCourier: false, boxCost: 0, courier: 0, food: 0, productCost: 0, uncostedItems: 0 });
    expect(e.products).toEqual([{ name: "Calzone Club Membership", quantity: 1, costed: true, variantId: "club", title: "Calzone Club Membership" }]);
    expect(e.orderProfit).toBe(20.33); // 20.83 revenue − 0.50 fees: just the card fees
  });

  it("a gift card in a food order costs nothing but the order still ships", () => {
    const e = costOrder(order({ lines: [
      { variantId: "v1", title: "Pepperoni", variantTitle: null, quantity: 2, price: 15, discount: 0 },
      { variantId: "gc", title: "£25 Gift Cards", variantTitle: null, quantity: 1, price: 25, discount: 0, requiresShipping: false, giftCard: true },
    ] }), costing, rates, londonDay);
    expect(e).toMatchObject({ box: "small", uncostedItems: 0, food: 6 });
  });

  it("takes VAT and refunds off revenue", () => {
    expect(costOrder(order({ totalTax: 1, refunded: 9 }), costing, rates, londonDay).revenue).toBe(50);
  });

  it("charges no courier or box for a collection", () => {
    const e = costOrder(order({ tags: "Collection" }), costing, rates, londonDay);
    expect(e).toMatchObject({ usesCourier: false, courier: 0, packaging: 1.6 });
  });

  it("charges the box but no courier for our own van", () => {
    expect(costOrder(order({ tags: "Small Box, Local Delivery" }), costing, rates, londonDay)).toMatchObject({ courier: 0, packaging: 4.1 });
  });

  it("uses the large rates for a large box", () => {
    expect(costOrder(order({ tags: "Large Box" }), costing, rates, londonDay)).toMatchObject({ courier: 5.72, packaging: 5.1 });
  });

  it("flags items with no costing rather than guessing", () => {
    const e = costOrder(order({ lines: [{ variantId: "zzz", title: "Mystery", variantTitle: null, quantity: 2, price: 5, discount: 0 }] }), costing, rates, londonDay);
    expect(e).toMatchObject({ uncostedItems: 2, food: 0, packs: 0 });
  });

  it("doesn't count extras as packs", () => {
    const e = costOrder(order({ lines: [
      { variantId: "v1", title: "Pepperoni", variantTitle: null, quantity: 4, price: 15, discount: 0 },
      { variantId: "mayo", title: "Garlic Mayo", variantTitle: null, quantity: 1, price: 2.66, discount: 0 },
    ] }), costing, rates, londonDay);
    expect(e).toMatchObject({ packs: 4, items: 5, food: 12.5 });
  });
});

const calibration: Calibration = { months: ["2026-09", "2026-10", "2026-11"], overheadMonthly: 19161, belowLineMonthly: 1462, otherCostOfSalesMonthly: 0, paymentFeeRate: 0.02, labourRate: 0.215 };

describe("periodPnl", () => {
  const econ = [
    costOrder(order({ id: 1 }), costing, rates, londonDay),
    costOrder(order({ id: 2, tags: "Large Box", totalPrice: 120, subtotalPrice: 113.05, lines: [{ variantId: "v1", title: "Pepperoni", variantTitle: null, quantity: 8, price: 15, discount: 0 }] }), costing, rates, londonDay),
  ];

  it("lays out QuickBooks' lines: gross profit, advertising, overheads per day, net profit", () => {
    const p = periodPnl(econ, { days: 14, labour: 120, advertising: 20, calibration });
    const amt = (k: string) => p.lines.find(l => l.key === k)!.amount;
    expect(amt("income")).toBe(180);
    expect(amt("production_labour")).toBe(120);
    expect(amt("gross_profit")).toBe(round(180 - amt("food") - amt("packaging") - amt("courier") - amt("payment_fees") - 120));
    expect(amt("after_advertising")).toBe(round(amt("gross_profit") - 20));
    expect(amt("overhead")).toBe(round(19161 * 12 / 365 * 14));
    expect(amt("net_profit")).toBe(round(amt("after_advertising") - amt("overhead") - amt("below_line")));
    expect(p).toMatchObject({ orders: 2, packs: 12, labourPerPack: 10, adsPerOrder: 10, labourSource: "planday" });
  });

  it("falls back to QuickBooks' labour share when Planday can't be read", () => {
    const p = periodPnl(econ, { days: 14, labour: null, advertising: 0, calibration });
    expect(p.lines.find(l => l.key === "production_labour")!.amount).toBe(round(180 * 0.215));
    expect(p.labourSource).toBe("estimate");
  });

  it("shares the period costs out to orders, and the orders add back up", () => {
    const p = periodPnl(econ, { days: 14, labour: 120, advertising: 20, calibration });
    const rows = orderRows(econ, p);
    expect(rows[0]).toMatchObject({ labour: 40, advertising: 10 }); // 4 packs × £10
    expect(rows[1]).toMatchObject({ labour: 80 });                  // 8 packs × £10
    const net = rows.reduce((t, r) => t + r.netProfit, 0);
    expect(net).toBeCloseTo(p.netProfit, 1);
    // Gross margin leaves out the shared ads and overheads
    for (const r of rows) expect(r.grossMargin).toBe(round((r.grossProfit / r.revenue) * 100));
    // Contribution margin is before labour as well
    for (const r of rows) expect(r.contributionMargin).toBe(round((r.orderProfit / r.revenue) * 100));
  });

  it("summarises by order size and by product", () => {
    const p = periodPnl(econ, { days: 14, labour: 120, advertising: 20, calibration });
    const rows = orderRows(econ, p);
    expect(bySize(rows).map(g => [g.label, g.orders])).toEqual([["4 packs", 1], ["8 packs", 1]]);
    const products = byProduct(rows, [order({ id: 1 }), order({ id: 2, lines: [{ variantId: "v1", title: "Pepperoni", variantTitle: null, quantity: 8, price: 15, discount: 0 }] })], costing);
    const pep = products.find(x => x.name === "Pepperoni")!;
    expect(pep).toMatchObject({ quantity: 11, ordersWithIt: 2 });
    // (3×15 − 6 + 8×15) takings − 11 × (3 + 0.40) costs, per unit
    expect(pep.unitContribution).toBe(round((45 - 6 + 120 - 11 * 3.4) / 11));
  });
});

describe("compareMonth", () => {
  it("sets predicted beside QuickBooks with the gap", () => {
    const p = periodPnl([costOrder(order({}), costing, rates, londonDay)], { days: 30, labour: 10, advertising: 5, calibration });
    const actual = { income: 61, food: 14, packaging: 4, courier: 5, payment_fees: 1, production_labour: 10, other_cost_of_sales: 0, advertising: 5, overhead: 100, below_line: 0, ignore: 0 } as Record<Bucket, number>;
    const rows = compareMonth(p, actual);
    expect(rows.find(r => r.key === "income")).toEqual({ key: "income", label: "Income", predicted: 60, actual: 61, gap: 1 });
    expect(rows.find(r => r.key === "gross_profit")!.actual).toBe(27);
    expect(rows.find(r => r.key === "operating_profit")!.actual).toBe(-78);
  });
});

function round(n: number) { return Math.round(n * 100) / 100; }

describe("isDigitalOnlyOrder", () => {
  it("only when every line with a quantity is digital", () => {
    expect(isDigitalOnlyOrder([{ quantity: 1, requiresShipping: false }])).toBe(true);
    expect(isDigitalOnlyOrder([{ quantity: 1, giftCard: true }, { quantity: 0, requiresShipping: true }])).toBe(true);
    expect(isDigitalOnlyOrder([{ quantity: 1, requiresShipping: false }, { quantity: 1, requiresShipping: true }])).toBe(false);
    expect(isDigitalOnlyOrder([{ quantity: 1 }])).toBe(false);
    expect(isDigitalOnlyOrder([])).toBe(false);
  });
});

describe("supplyUnitCosting — a supply sold through Shopify", () => {
  it("the order insert: £160.05 for 10,000 flyers is 1.6p each, as packaging", () => {
    const c = supplyUnitCosting({ name: "New Customer Order Inserts", costPerPack: 160.05, unitsPerPack: 10000, category: "packaging" })!;
    expect(c.packaging).toBeCloseTo(0.016, 4);
    expect(c.food).toBe(0);
  });
  it("a bought-in brownie counts as food", () => {
    const c = supplyUnitCosting({ name: "Caramel Shortbread", costPerPack: 50, unitsPerPack: 12, category: "other" })!;
    expect(c.food).toBeCloseTo(4.1667, 3);
    expect(c.packaging).toBe(0);
  });
  it("no cost on the supply → not costed from it", () => {
    expect(supplyUnitCosting({ name: "x", costPerPack: 0, unitsPerPack: 10, category: null })).toBeNull();
    expect(supplyUnitCosting({ name: "x", costPerPack: null, unitsPerPack: null, category: null })).toBeNull();
  });
});

describe("manualUnitCosting — a cost set by hand from the order pop-up (25 Nov 2026)", () => {
  it("food by default, packaging when it says so", () => {
    expect(manualUnitCosting({ title: "Hot Sauce", cost: 1.2, category: "food" })).toEqual({ name: "Hot Sauce", food: 1.2, packaging: 0, isPack: false });
    expect(manualUnitCosting({ title: "Gift bag", cost: 0.35, category: "packaging" })).toEqual({ name: "Gift bag", food: 0, packaging: 0.35, isPack: false });
    expect(manualUnitCosting({ title: "x", cost: 1, category: null })!.food).toBe(1);
  });
  it("no positive cost → nothing", () => {
    expect(manualUnitCosting({ title: "x", cost: 0, category: "food" })).toBeNull();
    expect(manualUnitCosting({ title: "x", cost: null, category: "food" })).toBeNull();
  });
});

describe("pickVariantCosting — recipe → supply → set in the app → Shopify", () => {
  const recipe: VariantCosting = { name: "Pepperoni", food: 3, packaging: 0.5, isPack: true };
  const supply: VariantCosting = { name: "Brownie", food: 1.5, packaging: 0, isPack: false };
  const manual: VariantCosting = { name: "Hot Sauce", food: 1.2, packaging: 0, isPack: false };
  it("a recipe wins over everything", () => {
    expect(pickVariantCosting({ title: "t", recipe, supply, manual, shopifyCost: 9 })).toEqual({ costing: recipe, source: "recipe" });
  });
  it("then a linked supply", () => {
    expect(pickVariantCosting({ title: "t", supply, manual, shopifyCost: 9 })).toEqual({ costing: supply, source: "supply" });
  });
  it("then the cost set in the app, over Shopify's", () => {
    expect(pickVariantCosting({ title: "t", manual, shopifyCost: 9 })).toEqual({ costing: manual, source: "manual" });
  });
  it("then Shopify's cost per item, as food", () => {
    expect(pickVariantCosting({ title: "Dip", shopifyCost: 0.8 })).toEqual({ costing: { name: "Dip", food: 0.8, packaging: 0, isPack: false }, source: "shopify" });
  });
  it("none (or a £0 Shopify cost) → uncosted", () => {
    expect(pickVariantCosting({ title: "t" })).toBeNull();
    expect(pickVariantCosting({ title: "t", shopifyCost: 0, supply: null, manual: null })).toBeNull();
  });
});
