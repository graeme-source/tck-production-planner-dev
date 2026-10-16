import { describe, it, expect } from "vitest";
import {
  factoryBand, forecastFactoryNumber, recommendBatchChange, parseFactoryThresholds, needsFreezeConfirmation,
  describeFactoryForecast, DEFAULT_FACTORY_THRESHOLDS, type FactoryForecastRow,
} from "./factory-forecast";

const row = (o: Partial<FactoryForecastRow> & { key: string }): FactoryForecastRow => ({
  recipeName: o.key, included: true, plannedBatches: 10, packsPerBatch: 5, startStockPacks: 0,
  bagPacks: 0, despatchPacks: 0, salesShare: 0, floorBatches: 0, ...o,
});
const noLate = { latePacks: 0, low: 0, high: 0 };

describe("factoryBand", () => {
  it("uses Graeme's bands", () => {
    expect(factoryBand(450)).toBe("too-low");
    expect(factoryBand(550)).toBe("low");
    expect(factoryBand(700)).toBe("under");
    expect(factoryBand(800)).toBe("target");
    expect(factoryBand(1000)).toBe("target");
    expect(factoryBand(1001)).toBe("above");
    expect(factoryBand(1250)).toBe("warning");
    expect(factoryBand(1500)).toBe("freeze");
  });
});

describe("forecastFactoryNumber", () => {
  it("start + made − bags − known despatch − late, per recipe, never below zero", () => {
    const rows = [
      row({ key: "a", startStockPacks: 400, plannedBatches: 20, bagPacks: 8, despatchPacks: 150, salesShare: 0.5 }),
      row({ key: "b", startStockPacks: 300, plannedBatches: 10, despatchPacks: 100, salesShare: 0.5 }),
      row({ key: "c", startStockPacks: 10, plannedBatches: 0, despatchPacks: 50, salesShare: 0 }), // short: clamps at 0
    ];
    const f = forecastFactoryNumber(rows, { latePacks: 100, low: 60, high: 160 });
    // a: 400 + 100 − 8 − 150 = 342 − 50 late = 292; b: 300 + 50 − 100 = 250 − 50 = 200; c: 0
    expect(f.knownEnd).toBe(592);
    expect(f.knownOrders).toBe(300);
    expect(f.predictedEnd).toBe(492);
    expect(f.perRecipe.map(r => r.predictedEnd)).toEqual([292, 200, 0]);
    // More late orders → fewer packs left, so the range flips.
    expect(f.low).toBe(432);
    expect(f.high).toBe(532);
    expect(f.band).toBe("too-low");
  });

  it("a row left out of the plan makes nothing", () => {
    const f = forecastFactoryNumber([row({ key: "a", included: false, startStockPacks: 100 })], noLate);
    expect(f.predictedEnd).toBe(100);
  });

  it("describes the working in one line", () => {
    const f = forecastFactoryNumber([row({ key: "a", startStockPacks: 1500, plannedBatches: 0, salesShare: 1 })], { latePacks: 260, low: 200, high: 330 });
    expect(describeFactoryForecast(f, { byWhen: "Mon 2pm", emails: 2 }))
      .toBe("Known orders leave 1,500 − predicted 260 more packs ordered by Mon 2pm incl. 2 emails = ~1,240");
  });
});

describe("recommendBatchChange", () => {
  it("at the 1,250 warning, takes batches off the recipe with the most cover until at or under 1,000", () => {
    const rows = [
      // a: lots of stock for its sales → most cover
      row({ key: "a", startStockPacks: 450, plannedBatches: 100, salesShare: 0.2 }),
      row({ key: "b", startStockPacks: 300, plannedBatches: 20, salesShare: 0.8 }),
    ];
    // ends: a 950, b 400 = 1,350
    const rec = recommendBatchChange(rows, noLate)!;
    expect(rec.direction).toBe("fewer");
    expect(rec.reason).toBe("warning");
    expect(rec.batches).toBe(70);
    expect(rec.changes).toEqual([{ key: "a", recipeName: "a", from: 100, to: 30 }]);
    expect(rec.landsOn).toBe(1000);
    expect(rec.aim).toBe(1000);
    expect(rec.limited).toBe(false);
  });

  it("between 1,000 and the warning: calm, no suggestion (Graeme's 1,058)", () => {
    const rows = [row({ key: "a", startStockPacks: 558, plannedBatches: 100, salesShare: 1 })];
    expect(forecastFactoryNumber(rows, noLate).predictedEnd).toBe(1058);
    expect(forecastFactoryNumber(rows, noLate).band).toBe("above");
    expect(recommendBatchChange(rows, noLate)).toBeNull();
  });

  it("above 1,000 with stock building for days → pull back to 1,000", () => {
    const rows = [row({ key: "a", startStockPacks: 558, plannedBatches: 100, salesShare: 1 })];
    const rec = recommendBatchChange(rows, noLate, DEFAULT_FACTORY_THRESHOLDS, { pullBack: { days: 3, latest: 1100, rise: 80 } })!;
    expect(rec.reason).toBe("pull-back");
    expect(rec.batches).toBe(12); // 1,058 − 12 × 5 = 998
    expect(rec.landsOn).toBe(998);
  });

  it("never takes the day below the fewest batches a day", () => {
    const rows = [row({ key: "a", startStockPacks: 1000, plannedBatches: 100, salesShare: 1 })];
    // 1,500 predicted; 80 batches is the floor → only 20 off, lands 1,400.
    const rec = recommendBatchChange(rows, noLate, DEFAULT_FACTORY_THRESHOLDS, { minTotalBatches: 80 })!;
    expect(rec.reason).toBe("freeze");
    expect(rec.batches).toBe(20);
    expect(rec.landsOn).toBe(1400);
    expect(rec.limited).toBe(true);
  });

  it("never goes below a recipe's orders + margin floor", () => {
    const rows = [
      row({ key: "a", startStockPacks: 1250, plannedBatches: 10, floorBatches: 10, salesShare: 0.1 }),
      row({ key: "b", startStockPacks: 0, plannedBatches: 4, floorBatches: 2, salesShare: 0.9 }),
    ];
    const rec = recommendBatchChange(rows, noLate)!;
    expect(rec.changes).toEqual([{ key: "b", recipeName: "b", from: 4, to: 2 }]);
    expect(rec.limited).toBe(true);
    expect(rec.landsOn).toBe(1310);
  });

  it("never runs a recipe's predicted end below zero", () => {
    const rows = [
      // a: 10 made − 6 predicted late = 4 left; one batch fewer would run out.
      row({ key: "a", startStockPacks: 0, plannedBatches: 2, salesShare: 1 }),
      // b: all stock, nothing planned to take off.
      row({ key: "b", startStockPacks: 1300, plannedBatches: 0, salesShare: 0 }),
    ];
    expect(recommendBatchChange(rows, { latePacks: 6, low: 4, high: 8 })).toBeNull();
  });

  it("adds batches to the least-covered recipe when under the 800 target, within capacity", () => {
    const rows = [
      row({ key: "a", startStockPacks: 300, plannedBatches: 10, despatchPacks: 50, salesShare: 0.5 }),
      row({ key: "b", startStockPacks: 100, plannedBatches: 10, despatchPacks: 50, salesShare: 0.5 }),
    ];
    // ends: 300, 100 = 400 → under 500, too low
    const rec = recommendBatchChange(rows, noLate, DEFAULT_FACTORY_THRESHOLDS, { maxTotalBatches: 100 })!;
    expect(rec.direction).toBe("more");
    expect(rec.reason).toBe("too-low");
    expect(rec.landsOn).toBe(800);
    expect(rec.batches).toBe(80);
    const capped = recommendBatchChange(rows, noLate, DEFAULT_FACTORY_THRESHOLDS, { maxTotalBatches: 30 })!;
    expect(capped.batches).toBe(10);
    expect(capped.limited).toBe(true);
  });

  it("inside the comfortable range → nothing to recommend", () => {
    expect(recommendBatchChange([row({ key: "a", startStockPacks: 850, plannedBatches: 0 })], noLate)).toBeNull();
  });

  it("700 (a little under 800) → more, toward 800", () => {
    const rec = recommendBatchChange([row({ key: "a", startStockPacks: 650, plannedBatches: 10, salesShare: 1 })], noLate)!;
    expect(rec.direction).toBe("more");
    expect(rec.reason).toBe("under");
    expect(rec.landsOn).toBe(800);
  });
});

describe("settings", () => {
  it("falls back per field and rejects an out-of-order set", () => {
    expect(parseFactoryThresholds({ targetHigh: "1100", warnAt: "" })).toEqual({ ...DEFAULT_FACTORY_THRESHOLDS, targetHigh: 1100 });
    expect(parseFactoryThresholds({ maxAt: "900" })).toEqual(DEFAULT_FACTORY_THRESHOLDS);
    // The fewest batches a day is a count, not a level — never "out of order".
    expect(parseFactoryThresholds({ minBatchesPerDay: "2000" }).minBatchesPerDay).toBe(2000);
  });

  it("defaults to Graeme's 16 Oct levels and 80 batches a day", () => {
    expect(DEFAULT_FACTORY_THRESHOLDS).toEqual({
      targetLow: 800, targetHigh: 1000, warnAt: 1250, maxAt: 1500, lowAmber: 600, lowRed: 500, minBatchesPerDay: 80,
    });
  });

  it("asks for a second tap at 1,500 and over only", () => {
    expect(needsFreezeConfirmation({ predictedEnd: 1499 })).toBe(false);
    expect(needsFreezeConfirmation({ predictedEnd: 1500 })).toBe(true);
  });
});
