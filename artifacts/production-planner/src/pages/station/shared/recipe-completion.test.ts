import { describe, it, expect } from "vitest";
import type { ProductionPlanItem } from "@workspace/api-client-react";
import { packsPerBatch, netTwoPacks, batchesReadyToWrap, itemRoute, packsWrapped } from "./recipe-completion";
import type { StationPlanItem } from "./constants";

const item = (p: Partial<StationPlanItem> & { stationCompletions?: Record<string, number> }): StationPlanItem =>
  ({ id: 1, recipeId: 27, batchesTarget: 6, portionsPerBatch: 10, packSize: 2, fridgeQty: 0, freezerQty: 0, ...p } as unknown as StationPlanItem);

// Buns as the plan API sends them after migration 0202.
const bun = (p: Partial<StationPlanItem> & { stationCompletions?: Record<string, number> } = {}) => item({
  portionsPerBatch: 48, packSize: "6.0000" as unknown as number, skipOvens: true, defaultStorage: "freezer",
  shopifyPushOnWrap: true, excludeFromKpis: true, ...p,
});

describe("pack maths in the recipe's own pack size", () => {
  // Regression (Graeme, 16 Oct 2026): a sheet of 48 buns in sixes showed
  // as 24 packs at wrapping — every station divided by a hard-coded 2.
  it("a bun sheet is 8 packs", () => {
    expect(packsPerBatch(bun() as ProductionPlanItem)).toBe(8);
    expect(netTwoPacks(bun(), 6, 6, 6)).toBe(48);
  });
  it("calzones are unchanged", () => {
    expect(packsPerBatch(item({}) as ProductionPlanItem)).toBe(5);
    expect(netTwoPacks(item({ wonlyCount: 2, eightPackBagCount: 1 } as Partial<StationPlanItem>), 4, 4, 4)).toBe(20 - 4 - 2);
  });
});

describe("skip-ovens route", () => {
  it("buns are ready to wrap as soon as the builders confirm batches", () => {
    const b = bun({ stationCompletions: { building_1: 2, building_2: 1, ovens: 0 } });
    expect(batchesReadyToWrap(b)).toBe(3);
    expect(netTwoPacks(b, batchesReadyToWrap(b), 6, 3)).toBe(24);
  });
  it("calzones still wait for the ovens", () => {
    const c = item({ stationCompletions: { building_1: 4, building_2: 4, ovens: 5 } });
    expect(batchesReadyToWrap(c)).toBe(5);
  });
  it("reads the route, defaulting to the standard one", () => {
    expect(itemRoute(bun())).toMatchObject({ skipOvens: true, defaultStorage: "freezer" });
    expect(itemRoute(item({}))).toMatchObject({ skipOvens: false, defaultStorage: "fridge" });
  });
  it("wrapped counts the freezer too", () => {
    expect(packsWrapped(bun({ freezerQty: 16, fridgeQty: 0 }))).toBe(16);
  });
});
