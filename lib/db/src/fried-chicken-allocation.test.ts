import { describe, it, expect } from "vitest";
import {
  allocateFriedChickenPacks, dptSharesFromSales,
  type VariantAllocationInput,
} from "./fried-chicken-allocation";

// The four variants, with the strip weight each bag spends. Korean bags carry
// sauce, so they hold less chicken than their bag size suggests.
const STRIP = { bm400: 0.400, bm1k: 1.000, k500: 0.3344, k12: 0.8024 };

// 30 days of real sales, Aug-Sep 2026.
const SALES = { bm400: 217, bm1k: 31, k500: 205, k12: 27 };
const DPT = dptSharesFromSales(SALES);

const variants = (stock: Record<string, number>): VariantAllocationInput[] =>
  (Object.keys(STRIP) as Array<keyof typeof STRIP>).map(k => ({
    key: k,
    dptShare: DPT[k]!,
    stripKgPerPack: STRIP[k],
    stockPacks: stock[k] ?? 0,
  }));

const packsOf = (r: ReturnType<typeof allocateFriedChickenPacks>) =>
  Object.fromEntries(r.variants.map(v => [v.key, v.packs]));

describe("dptSharesFromSales", () => {
  it("turns sales into shares that sum to 1", () => {
    const sum = Object.values(DPT).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(DPT.bm400).toBeCloseTo(217 / 480, 6);
  });

  it("survives a variant that has never sold", () => {
    const d = dptSharesFromSales({ a: 10, b: 0 });
    expect(d.b).toBe(0);
    expect(d.a).toBe(1);
  });

  it("doesn't divide by zero when nothing has sold", () => {
    expect(dptSharesFromSales({ a: 0, b: 0 })).toEqual({ a: 0, b: 0 });
  });
});

describe("allocation", () => {
  it("never spends more strips than it was given", () => {
    const r = allocateFriedChickenPacks(variants({ bm400: 51, bm1k: 29, k500: 12, k12: 23 }), 62.553);
    expect(r.stripKgUsed).toBeLessThanOrEqual(62.553);
  });

  // The real case, from the day of Graeme's spreadsheet: korean 500g was on
  // 1.8 days of cover while the big bags sat on 26+. The whole point of
  // targeting stock rather than production is that this run goes where the
  // shortage is.
  it("feeds the variant that is nearly out and skips the ones sitting on a month", () => {
    const p = packsOf(allocateFriedChickenPacks(
      variants({ bm400: 51, bm1k: 29, k500: 12, k12: 23 }), 62.553));
    expect(p.k500).toBeGreaterThan(p.bm400);
    expect(p.bm1k).toBe(0);
    expect(p.k12).toBe(0);
  });

  // Weight-based splitting was what quietly over-stocked the big bags: a
  // 1.2kg bag is 3x the weight but still one sale.
  it("does not hand the big bags a share just because they weigh more", () => {
    const p = packsOf(allocateFriedChickenPacks(variants({ bm400: 0, bm1k: 0, k500: 0, k12: 0 }), 62.553));
    expect(p.bm400).toBeGreaterThan(p.bm1k * 4);
    expect(p.k500).toBeGreaterThan(p.k12 * 4);
  });

  it("from an empty shelf, splits roughly by the DPT shares", () => {
    const r = allocateFriedChickenPacks(variants({ bm400: 0, bm1k: 0, k500: 0, k12: 0 }), 62.553);
    const share = (k: string) => r.variants.find(v => v.key === k)!.packs / r.totalPacks;
    expect(share("bm400")).toBeCloseTo(DPT.bm400!, 1);
    expect(share("k500")).toBeCloseTo(DPT.k500!, 1);
  });

  it("leaves stock closer to the target than it found it", () => {
    const start = { bm400: 51, bm1k: 29, k500: 12, k12: 23 };
    const r = allocateFriedChickenPacks(variants(start), 62.553);
    const drift = (stock: Record<string, number>) => {
      const tot = Object.values(stock).reduce((a, b) => a + b, 0);
      return Object.entries(stock).reduce((d, [k, v]) => d + Math.abs(v / tot - DPT[k]!), 0);
    };
    const after = Object.fromEntries(r.variants.map(v => [v.key, v.stockAfter]));
    expect(drift(after)).toBeLessThan(drift(start));
  });

  // There is always somewhere to put the chicken: raising the target total
  // lifts every variant's target with it, so the run never has "nothing to
  // do". The only strips left over are the ones that couldn't buy a whole
  // extra bag.
  it("spends everything bar the change", () => {
    for (const stock of [
      { bm400: 51, bm1k: 29, k500: 12, k12: 23 },
      { bm400: 500, bm1k: 500, k500: 500, k12: 500 },
      { bm400: 0, bm1k: 0, k500: 0, k12: 0 },
    ]) {
      const r = allocateFriedChickenPacks(variants(stock), 62.553);
      expect(r.stripKgUsed + r.stripKgSpare).toBeCloseTo(62.553, 2);
      // Whatever is left could not have bought another bag of anything.
      expect(r.stripKgSpare).toBeLessThan(Math.max(...Object.values(STRIP)));
    }
  });

  it("still tops up the short ones when everything is generously stocked", () => {
    // Equal stock is NOT balanced stock: 500 each is 25% apiece, while the
    // targets are 45/43/6.5/5.6. The two small bags are the ones behind.
    const p = packsOf(allocateFriedChickenPacks(
      variants({ bm400: 500, bm1k: 500, k500: 500, k12: 500 }), 62.553));
    expect(p.bm400 + p.k500).toBeGreaterThan(0);
    expect(p.bm1k).toBe(0);
    expect(p.k12).toBe(0);
  });

  it("makes whole bags only", () => {
    const r = allocateFriedChickenPacks(variants({ bm400: 3, bm1k: 1, k500: 2, k12: 0 }), 41.8);
    for (const v of r.variants) expect(Number.isInteger(v.packs)).toBe(true);
  });

  it("will happily make a single big bag — there is no minimum", () => {
    const r = allocateFriedChickenPacks(
      [{ key: "k12", dptShare: 1, stripKgPerPack: 0.8024, stockPacks: 0 }], 0.9);
    expect(packsOf(r).k12).toBe(1);
  });

  it("copes with no chicken, no variants, and nonsense weights", () => {
    expect(allocateFriedChickenPacks(variants({}), 0).totalPacks).toBe(0);
    expect(allocateFriedChickenPacks([], 50).totalPacks).toBe(0);
    const odd = allocateFriedChickenPacks(
      [{ key: "x", dptShare: 1, stripKgPerPack: 0, stockPacks: 0 }], 50);
    expect(odd.totalPacks).toBe(0);
  });

  it("scales with the chicken: more raw meat, more bags", () => {
    const small = allocateFriedChickenPacks(variants({ bm400: 10, bm1k: 2, k500: 5, k12: 1 }), 30);
    const big = allocateFriedChickenPacks(variants({ bm400: 10, bm1k: 2, k500: 5, k12: 1 }), 62.553);
    expect(big.totalPacks).toBeGreaterThan(small.totalPacks);
  });
});
