import { describe, it, expect } from "vitest";
import {
  batchesOf, costPerIngredientUnit, defectPacksFor, hourlyLabourRate, ingredientWasteCost, productLostValue,
  productMaterialCost, productPacks, remakeTimeCost, standardRemakeMinutes, subRecipeWasteCost, wasteByDay,
  wasteSnapshot, wasteUnitsFor, packLabel, type ProductBasis, type SubRecipeBasis,
} from "./waste-cost";
import { deriveDay, madeByLine, FALLBACK_SETTINGS, type DayComponents, type TeSettings } from "./team-efficiency-day";

// Names here are test data — the module knows none.
const LINE = "A line with a 22% discount";
const settings: TeSettings = { ...FALLBACK_SETTINGS, despatchShare: 0.11, discountRates: { [LINE]: 0.22 }, eightPackFactor: 0.72 };

describe("what can be entered", () => {
  it("offers kg and g for weights, own unit first for volumes, own unit only for counts", () => {
    expect(wasteUnitsFor("kg")).toEqual(["kg", "g"]);
    expect(wasteUnitsFor("g")).toEqual(["kg", "g"]);
    expect(wasteUnitsFor("l")).toEqual(["l", "kg", "g"]);
    expect(wasteUnitsFor("each")).toEqual(["each"]);
  });
  it("names packs by their size", () => {
    expect(packLabel(2)).toBe("2-pack");
    expect(packLabel(6)).toBe("6-pack");
    expect(packLabel(1)).toBe("Single pack");
  });
});

describe("ingredients", () => {
  const cheese = { unit: "kg", costPerPack: 10.21, packWeight: 1 };
  it("prices the amount at cost per pack ÷ pack weight", () => {
    expect(costPerIngredientUnit(cheese)).toBeCloseTo(10.21);
    expect(ingredientWasteCost(2.3, "kg", cheese)).toBeCloseTo(23.483);
  });
  it("converts grams to the ingredient's kilos through @workspace/units", () => {
    expect(ingredientWasteCost(500, "g", cheese)).toBeCloseTo(5.105);
  });
  it("prices a count ingredient in its own unit", () => {
    expect(ingredientWasteCost(3, "each", { unit: "each", costPerPack: 12, packWeight: 24 })).toBeCloseTo(1.5);
  });
  it("can't price a count in kilos, or with no pack size", () => {
    expect(ingredientWasteCost(3, "each", cheese)).toBeNull();
    expect(ingredientWasteCost(1, "kg", { unit: "kg", costPerPack: 5, packWeight: 0 })).toBeNull();
  });
});

describe("sub-recipes", () => {
  // The 2026-10-09 nacho cheese: a 0.414 kg batch whose ingredients cost
  // £2.4512 → £5.921/kg (computeSubRecipeCosts: batch cost ÷ yield).
  const nacho: SubRecipeBasis = { yieldUnit: "kg", batchYield: 0.414, costPerYieldUnit: 2.4512 / 0.414, standardPrepMinutes: 20 };
  it("prices by cost per yield unit (batch cost ÷ yield)", () => {
    expect(subRecipeWasteCost(2.3, "kg", nacho)).toBeCloseTo(13.62, 2);
    expect(subRecipeWasteCost(2300, "g", nacho)).toBeCloseTo(13.62, 2);
  });
  it("scales the standard prep time by amount ÷ batch yield", () => {
    expect(batchesOf(2.3, "kg", nacho)).toBeCloseTo(5.556, 3);
    expect(standardRemakeMinutes(2.3, "kg", nacho)).toBe(111); // 20 × 5.556
    expect(standardRemakeMinutes(10, "g", nacho)).toBe(1);     // never rounds to nothing
  });
  it("has no standard time when none is set", () => {
    expect(standardRemakeMinutes(2.3, "kg", { ...nacho, standardPrepMinutes: null })).toBeNull();
  });
});

describe("finished packs", () => {
  const twoPack: ProductBasis = { packSize: 2, rrp: 15.95, category: LINE, ingredientCostPerPack: 3.1, packagingCostPerPack: 0.4 };
  it("counts an 8-pack bag as 8 ÷ pack size packs", () => {
    expect(productPacks(3, "pack", 2)).toBe(3);
    expect(productPacks(2, "eight_pack_bag", 2)).toBe(8);
  });
  it("materials are ingredients + packaging per pack", () => {
    expect(productMaterialCost(4, "pack", twoPack)).toBeCloseTo(14);
    expect(productMaterialCost(1, "eight_pack_bag", twoPack)).toBeCloseTo(14);
  });
  it("lost value is what efficiency credited it with when made: RRP less discount × made share", () => {
    expect(productLostValue(4, "pack", twoPack, settings)).toBeCloseTo(4 * 15.95 * 0.78 * 0.89, 6);
    expect(productLostValue(1, "eight_pack_bag", twoPack, settings)).toBeCloseTo(4 * 15.95 * 0.72 * 0.89, 6);
  });
  it("lost value of N packs equals the credit those N packs add to a day", () => {
    // The deduction exactly reverses the credit — no more, no less.
    const base = (fridgeQty: number): DayComponents => ({
      date: "2026-10-08",
      made: madeByLine([{ category: LINE, fridgeQty, eightPackBags: 0, batchesTarget: 50, batchesComplete: 50, portionsPerBatch: 10, packSize: 2, rrp: 15.95 }]),
      despatched: {}, ordersDespatched: 0, labourCostTotal: 1000, lineLabour: {}, paidHours: 60, headcount: 8,
      pendingShifts: 0, ignoredUnapproved: 0,
    });
    const credit = deriveDay(base(250), settings).valueCredited - deriveDay(base(246), settings).valueCredited;
    expect(productLostValue(4, "pack", twoPack, settings)).toBeCloseTo(credit, 6);
  });
  it("adds whole packs to the Defects KPI for products only", () => {
    expect(defectPacksFor("product", 3, "pack", 2)).toBe(3);
    expect(defectPacksFor("product", 1, "eight_pack_bag", 2)).toBe(4);
    expect(defectPacksFor("sub_recipe", 2.3, null, 0)).toBe(0);
    expect(defectPacksFor("ingredient", 5, null, 0)).toBe(0);
  });
});

describe("time", () => {
  it("averages cost over paid hours (ratio of sums), leaving out pending days", () => {
    const r = hourlyLabourRate([
      { date: "2026-10-01", status: "ok", labourCostTotal: 1000, paidHours: 60 },
      { date: "2026-10-02", status: "excluded", labourCostTotal: 500, paidHours: 40 },
      { date: "2026-10-05", status: "pending", labourCostTotal: 9999, paidHours: 1 },
      { date: "2026-10-03", status: "no_labour", labourCostTotal: 0, paidHours: 0 },
    ]);
    expect(r?.rate).toBeCloseTo(15);
    expect(r).toMatchObject({ from: "2026-10-01", to: "2026-10-02", days: 2 });
    expect(hourlyLabourRate([])).toBeNull();
  });
  it("prices minutes at the hourly rate", () => {
    expect(remakeTimeCost(30, 17.03)).toBeCloseTo(8.515);
    expect(remakeTimeCost(-5, 17)).toBe(0);
  });
});

describe("wasteSnapshot", () => {
  it("rounds to pennies and totals ingredients + time", () => {
    const s = wasteSnapshot({ ingredientCost: 13.6186, lostValue: 13.6186, remakeMinutes: 45, hourlyRate: 17.0275 });
    expect(s).toMatchObject({ ingredientCost: 13.62, timeCost: 12.77, totalCost: 26.39, lostValue: 13.62, remakeMinutes: 45 });
  });
  it("0 minutes is £0 time even without an hourly rate", () => {
    expect(wasteSnapshot({ ingredientCost: 5, lostValue: 5, remakeMinutes: 0, hourlyRate: null }).timeCost).toBe(0);
    expect(wasteSnapshot({ ingredientCost: 5, lostValue: 5, remakeMinutes: 30, hourlyRate: null }).timeCost).toBeNull();
  });
});

describe("the efficiency deduction", () => {
  const day = (wasteValue?: number): DayComponents => ({
    date: "2026-10-08",
    made: madeByLine([{ category: LINE, fridgeQty: 500, eightPackBags: 0, batchesTarget: 100, batchesComplete: 100, portionsPerBatch: 10, packSize: 2, rrp: 15 }]),
    despatched: {}, ordersDespatched: 0, labourCostTotal: 1200, lineLabour: {}, paidHours: 70, headcount: 9,
    pendingShifts: 0, ignoredUnapproved: 0, wasteValue,
  });

  it("takes the day's lost value off credited value — and only that", () => {
    const before = deriveDay(day(), settings);
    const after = deriveDay(day(13.62), settings);
    expect(after.wasteValue).toBe(13.62);
    expect(after.valueCredited).toBeCloseTo(before.valueCredited - 13.62, 6);
    expect(after.labourCost).toBe(before.labourCost); // remake time is NOT deducted — wages already in labour
    expect(after.ratio!).toBeLessThan(before.ratio!);
  });

  it("never takes credited value below zero", () => {
    expect(deriveDay(day(1e9), settings).valueCredited).toBe(0);
  });

  it("sums lost value by the day it happened; time and old records add nothing", () => {
    const m = wasteByDay([
      { occurredOn: "2026-10-08", lostValue: 13.62 },
      { occurredOn: "2026-10-08", lostValue: 2.5 },
      { occurredOn: "2026-10-07", lostValue: null }, // an old defect: no item, no cost
      { occurredOn: "2026-10-06", lostValue: 0 },
    ]);
    expect(m.get("2026-10-08")).toBeCloseTo(16.12);
    expect(m.has("2026-10-07")).toBe(false);
    expect(m.has("2026-10-06")).toBe(false);
  });

  it("wonkies were never credited, so nothing is deducted for them", () => {
    // freezer wonkies aren't in fridge_qty → not in made → not credited; the
    // waste form says not to re-enter them, so they can't be deducted twice.
    const plain = deriveDay(day(), settings).valueCredited;
    expect(deriveDay({ ...day(), wasteValue: 0 }, settings).valueCredited).toBe(plain);
  });
});
