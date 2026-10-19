import { describe, it, expect } from "vitest";
import {
  readRecipeRoute, STANDARD_ROUTE, feedingStations, goesThroughOvens,
  packsPerBatch, packsFromBatches, batchesForPacks,
  kpiKitchenLine, countsInKpis,
  capacityBatchesFor, capacityUsed, capacityBreakdown, formatCapacityBreakdown,
  usesShopifyStock, billetPortionG, billetGrams,
} from "./recipe-route";
import { mainKitchenBatches } from "./kitchen-scope";

// The bun recipe as migration 0202 sets it — described by data, not name.
const BUN_ROUTE = { skipOvens: true, defaultStorage: "freezer", shopifyPushOnWrap: true, excludeFromKpis: true, calzoneBatchEquivalent: "3.333333" };
const bun = { category: "Desserts", portionsPerBatch: 48, packSize: "6.0000", calzoneBatchEquivalent: "3.333333" };

describe("readRecipeRoute", () => {
  it("treats a missing route as the standard calzone route", () => {
    expect(readRecipeRoute(null)).toEqual(STANDARD_ROUTE);
    expect(readRecipeRoute({})).toEqual(STANDARD_ROUTE);
  });
  it("parses the numeric equivalence and the storage default", () => {
    const r = readRecipeRoute(BUN_ROUTE);
    expect(r).toMatchObject({ skipOvens: true, defaultStorage: "freezer", shopifyPushOnWrap: true, excludeFromKpis: true });
    expect(r.calzoneBatchEquivalent).toBeCloseTo(3.333333);
  });
  it("ignores junk", () => {
    expect(readRecipeRoute({ defaultStorage: "garage", calzoneBatchEquivalent: "x" })).toMatchObject({ defaultStorage: "fridge", calzoneBatchEquivalent: null });
  });
});

describe("billet portion weight (Graeme, 19 Oct 2026: made at 2,544 g, portioned at 2,467 g)", () => {
  it("uses the recipe's billet weight when set", () => {
    expect(readRecipeRoute({ billetWeightG: 2467 }).billetWeightG).toBe(2467);
    expect(billetPortionG(2.544, 2467)).toBe(2467);
  });
  it("falls back to the dough per batch when unset or junk", () => {
    expect(billetPortionG(2.544, null)).toBe(2544);
    expect(billetPortionG(2.544, "0")).toBe(2544);
    expect(billetGrams("abc")).toBeNull();
  });
});

describe("station chain", () => {
  it("standard recipes: wrapping waits for the ovens", () => {
    expect(feedingStations("wrapping", {})).toEqual(["ovens"]);
    expect(feedingStations("ovens", {})).toEqual(["building_1", "building_2"]);
    expect(goesThroughOvens({})).toBe(true);
  });
  it("skip-ovens recipes: wrapping follows the builders' confirmed batches", () => {
    expect(feedingStations("wrapping", { skipOvens: true })).toEqual(["building_1", "building_2"]);
    expect(goesThroughOvens({ skipOvens: true })).toBe(false);
  });
  it("building starts the chain", () => {
    expect(feedingStations("building_1", { skipOvens: true })).toEqual([]);
  });
});

describe("pack maths uses the recipe's own pack size", () => {
  // Regression: every station divided by a hard-coded 2, so one sheet of 48
  // buns in packs of 6 showed as 24 packs instead of 8 (Graeme, 16 Oct 2026).
  it("a bun sheet is 8 packs, not 24", () => {
    expect(packsPerBatch(bun.portionsPerBatch, bun.packSize)).toBe(8);
    expect(packsFromBatches(6, bun.portionsPerBatch, bun.packSize)).toBe(48);
  });
  it("calzones are unchanged (10 portions in 2s = 5)", () => {
    expect(packsPerBatch(10, 2)).toBe(5);
    expect(packsFromBatches(3, 10, "2.0000")).toBe(15);
  });
  it("falls back to a pack of 2 when the pack size is missing", () => {
    expect(packsPerBatch(10, null)).toBe(5);
    expect(packsFromBatches(1, 10, 0)).toBe(5);
  });
  it("packs to batches rounds up", () => {
    expect(batchesForPacks(48, 48, 6)).toBe(6);
    expect(batchesForPacks(49, 48, 6)).toBe(7);
    expect(batchesForPacks(0, 48, 6)).toBe(0);
  });
});

describe("KPIs leave flagged recipes out", () => {
  it("excludeFromKpis puts a calzone-line recipe outside the KPIs", () => {
    expect(kpiKitchenLine("Desserts", true)).toBe("separate");
    expect(countsInKpis("Desserts", true)).toBe(false);
  });
  it("everything else keeps its kitchen line", () => {
    expect(kpiKitchenLine("Desserts", false)).toBe("calzone");
    expect(kpiKitchenLine("Macaroni Cheese", null)).toBe("mac");
    expect(countsInKpis("Fried Chicken", false)).toBe(false);
  });
});

describe("capacity equivalence: 48 packs of buns ≈ 20 calzone batches", () => {
  const calzones = { name: "Pepperoni", category: "Calzones", batchesTarget: 90, portionsPerBatch: 10, packSize: 2 };
  const buns = { name: "Cinnamon Buns", ...bun, batchesTarget: 6 };

  it("6 bun batches use 20 batches of capacity", () => {
    expect(capacityBatchesFor(buns)).toBeCloseTo(20, 4);
    expect(capacityUsed([buns])).toBe(20);
  });
  it("a 110-batch day: 90 calzone batches + 48 packs of buns", () => {
    expect(capacityUsed([calzones, buns])).toBe(110);
    expect(mainKitchenBatches([calzones, buns])).toBe(110);
    const b = capacityBreakdown([calzones, buns]);
    expect(b).toMatchObject({ standardBatches: 90, total: 110 });
    expect(b.equivalents).toEqual([{ name: "Cinnamon Buns", batches: 6, packs: 48, capacity: 20 }]);
    expect(formatCapacityBreakdown(b)).toBe("90 batches + 48 packs Cinnamon Buns (≈20) = 110");
  });
  it("3 bun batches (24 packs) use 10", () => {
    expect(capacityUsed([{ ...buns, batchesTarget: 3 }])).toBe(10);
  });
  it("recipes without an equivalence count one for one; fried chicken not at all", () => {
    expect(capacityUsed([calzones, { category: "Fried Chicken", batchesTarget: 150 }])).toBe(90);
    expect(mainKitchenBatches([calzones, { category: "Macaroni Cheese", batchesTarget: 12 }])).toBe(102);
    expect(formatCapacityBreakdown(capacityBreakdown([calzones]))).toBe("90");
  });
});

describe("usesShopifyStock", () => {
  it("fried chicken and wrap-to-Shopify recipes read Shopify on-hand", () => {
    expect(usesShopifyStock("Fried Chicken", false)).toBe(true);
    expect(usesShopifyStock("Desserts", true)).toBe(true);
    expect(usesShopifyStock("Calzones", false)).toBe(false);
  });
});
