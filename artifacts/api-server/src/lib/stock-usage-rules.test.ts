import { describe, expect, it } from "vitest";
import {
  builtBatchFraction,
  calcTinCount,
  directLineChannel,
  isTinOutstanding,
  lineRawQtyForItem,
  subRecipeLineChannel,
  tinCountForLine,
} from "./stock-usage-rules";

const line = (over: Partial<Parameters<typeof directLineChannel>[0]> = {}) => ({
  isTopping: false, includeInFillingMix: false, category: "vegetable", ingredientName: "Red peppers", ...over,
});

describe("directLineChannel — where a recipe line is used", () => {
  it("prep tins for ordinary filling ingredients", () => {
    expect(directLineChannel(line())).toBe("prep");
    expect(directLineChannel(line({ includeInFillingMix: true, category: "raw_meat" }))).toBe("prep");
  });
  it("building for toppings", () => {
    expect(directLineChannel(line({ isTopping: true, category: "herb" }))).toBe("build");
  });
  it("mixing or building for base/sauce/dough-category lines, never tins", () => {
    expect(directLineChannel(line({ category: "sauce", includeInFillingMix: true }))).toBe("mixing");
    expect(directLineChannel(line({ category: "sauce" }))).toBe("build");
    expect(directLineChannel(line({ category: "base", includeInFillingMix: true }))).toBe("mixing");
  });
  it("topping mozzarella at building; in the filling mix it is prepped", () => {
    expect(directLineChannel(line({ category: "cheese", ingredientName: "Mozzarella" }))).toBe("build");
    expect(directLineChannel(line({ category: "cheese", ingredientName: "Mozzarella", includeInFillingMix: true }))).toBe("prep");
  });
  it("sub-recipe lines: mixing when in the filling mix, else building", () => {
    expect(subRecipeLineChannel(true)).toBe("mixing");
    expect(subRecipeLineChannel(false)).toBe("build");
  });
});

describe("tins", () => {
  it("splits batches into tins as the prep screens do", () => {
    expect(calcTinCount(4, 4)).toBe(1);
    expect(calcTinCount(6, 6)).toBe(2); // more than 5 batches → at least 2
    expect(calcTinCount(13, 4)).toBe(4);
    expect(calcTinCount(5, null)).toBeNull();
  });
  it("honours overrides", () => {
    const base = { batchesTarget: 12, maxBatchesPerTin: 4, includeInFillingMix: false, mixingTinOverride: null, tinOverride: null };
    expect(tinCountForLine(base)).toBe(3);
    expect(tinCountForLine({ ...base, tinOverride: 5 })).toBe(5);
    expect(tinCountForLine({ ...base, includeInFillingMix: true, mixingTinOverride: 2, tinOverride: 5 })).toBe(2);
    expect(tinCountForLine({ ...base, maxBatchesPerTin: null })).toBe(1);
  });
  it("a tin ticked at or before the count is inside it", () => {
    expect(isTinOutstanding(100, 200)).toBe(false);
    expect(isTinOutstanding(200, 200)).toBe(false);
    expect(isTinOutstanding(300, 200)).toBe(true);
    expect(isTinOutstanding(null, 200)).toBe(true);
    expect(isTinOutstanding(100, null)).toBe(true);
  });
});

describe("lineRawQtyForItem", () => {
  it("is per-portion × portions × batches plus Mix +g, cooked → raw", () => {
    // 0.05 kg × 10 portions × 12 batches = 6 kg cooked, + 0.3 Mix +g = 6.3, ÷ 0.7
    expect(lineRawQtyForItem({ quantityPerPortion: 0.05, portionsPerBatch: 10, batches: 12, mixExtra: 0.3, processingRatio: 0.7 })).toBeCloseTo(9);
    expect(lineRawQtyForItem({ quantityPerPortion: 0.05, portionsPerBatch: 10, batches: 2, mixExtra: 0, processingRatio: null })).toBeCloseTo(1);
  });
});

describe("builtBatchFraction", () => {
  it("is a whole batch unless a partial batch was recorded", () => {
    expect(builtBatchFraction(null, 10, 2)).toBe(1);
    expect(builtBatchFraction(3, 10, 2)).toBeCloseTo(0.6);
    expect(builtBatchFraction(9, 10, 2)).toBe(1);
  });
});
