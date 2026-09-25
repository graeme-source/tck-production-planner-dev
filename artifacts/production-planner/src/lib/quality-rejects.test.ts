import { describe, it, expect } from "vitest";
import { formatQualityRejects, packsLeftToClassify, QUALITY_REJECT_COPY } from "./quality-rejects";
import { netTwoPacks } from "../pages/station/shared/recipe-completion";
import type { StationPlanItem } from "../pages/station/shared/constants";

function item(over: Partial<StationPlanItem> = {}): StationPlanItem {
  return {
    id: 1, planId: 1, recipeId: 1, recipeName: "Test", portionsPerBatch: 10,
    status: "pending", orderPosition: 0, batchesTarget: 10, batchesComplete: 0,
    wonlyCount: 0, extraPacksBuilt: 0, wrappingComplete: false, fridgeQty: 0, freezerQty: 0,
    ...over,
  } as StationPlanItem;
}

describe("net two-packs heading for the fridge (ovens Net 2-Pk, wrapping In Chiller)", () => {
  it("a dog bin reduces the predicted fridge packs", () => {
    // 10 batches through the ovens = 50 two-packs.
    expect(netTwoPacks(item(), 10)).toBe(50);
    expect(netTwoPacks(item({ dogBinCount: 3 }), 10)).toBe(47);
  });

  it("removing a dog bin restores the count", () => {
    expect(netTwoPacks(item({ dogBinCount: 1 }), 10) + 1).toBe(netTwoPacks(item({ dogBinCount: 0 }), 10));
  });

  it("wonky behaviour is unchanged, and the two kinds add up", () => {
    expect(netTwoPacks(item({ wonlyCount: 4 }), 10)).toBe(46);
    expect(netTwoPacks(item({ wonlyCount: 4, dogBinCount: 2 }), 10)).toBe(44);
    // An item from an older API payload with no dog bin field reads as before.
    const legacy = item({ wonlyCount: 4 });
    delete (legacy as { dogBinCount?: number }).dogBinCount;
    expect(netTwoPacks(legacy, 10)).toBe(46);
  });

  it("8-pack bags, shorts and extras still behave as before alongside dog bins", () => {
    // 50 gross − 2 bags×4 − 1 wonky − 1 dog bin + 3 extras (credited: ovens caught up).
    expect(netTwoPacks(item({ eightPackBagCount: 2, wonlyCount: 1, dogBinCount: 1, extraPacksBuilt: 3 }), 10, 10, 10)).toBe(43);
    // Never negative before the extras credit.
    expect(netTwoPacks(item({ dogBinCount: 99 }), 10)).toBe(0);
  });
});

describe("packsLeftToClassify (can another reject be recorded?)", () => {
  it("counts dog bins as accounted for, like fridge, freezer and wonky", () => {
    expect(packsLeftToClassify({ grossPacks: 20, fridgeQty: 10, freezerQty: 2, wonlyCount: 3, dogBinCount: 0 })).toBe(5);
    expect(packsLeftToClassify({ grossPacks: 20, fridgeQty: 10, freezerQty: 2, wonlyCount: 3, dogBinCount: 5 })).toBe(0);
    expect(packsLeftToClassify({ grossPacks: 20, fridgeQty: 30, freezerQty: 0, wonlyCount: 0, dogBinCount: 0 })).toBe(0);
  });
});

describe("wording", () => {
  it("writes the pair out as two separate figures", () => {
    expect(formatQualityRejects(6, 2)).toBe("6 wonky · 2 dog bin");
    expect(formatQualityRejects(3, 0)).toBe("3 wonky · 0 dog bin");
  });

  it("points each kind at its own endpoint", () => {
    expect(QUALITY_REJECT_COPY.wonky.path).toBe("wonly");
    expect(QUALITY_REJECT_COPY.dog_bin.path).toBe("dog-bin");
  });
});
