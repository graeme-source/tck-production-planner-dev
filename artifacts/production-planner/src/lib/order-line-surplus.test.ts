import { describe, it, expect } from "vitest";
import { suggestedPacks, withDeliverySurplus, surplusDependsOnDeliveryDay, type SurplusLineFields } from "./order-line-surplus";

// Red Tractor chicken as the server sends it for a Monday delivery.
const chicken: SurplusLineFields = {
  totalRequired: 9.5,
  surplusTarget: 12.35,
  packWeight: 2.5,
  isKanban: false,
  surplusPercentApplied: 130,
  surplusFromDeliveryDay: true,
  surplusDeliveryDate: "2026-10-12",
  surplusExplanation: "Surplus 130% (delivery Mon)",
  surplusDailyRequirement: 9.5,
  surplusMode: "percent",
  surplusBasePercent: 30,
  surplusAbsoluteQty: null,
  surplusByDeliveryWeekday: { 1: 130, 2: 130, 3: 130, 4: 30, 5: 30 },
};

describe("suggestedPacks", () => {
  it("required + surplus − stock in whole packs", () => {
    expect(suggestedPacks(chicken, 4)).toBe(8); // (9.5 + 12.35 − 4) / 2.5 = 7.14 → 8
  });
  it("kanban floor and case rounding still apply", () => {
    expect(suggestedPacks({ ...chicken, isKanban: true, kanbanFloorPacks: 10 }, 4)).toBe(10);
    expect(suggestedPacks({ ...chicken, caseSizePacks: 6 }, 4)).toBe(12);
    expect(suggestedPacks({ ...chicken, surplusTarget: 0 }, 100)).toBe(0);
  });
});

describe("withDeliverySurplus", () => {
  it("moving the delivery to Thursday drops the surplus to 30%", () => {
    const thu = withDeliverySurplus(chicken, new Date(2026, 9, 15));
    expect(thu.surplusPercentApplied).toBe(30);
    expect(thu.surplusTarget).toBeCloseTo(2.85);
    expect(thu.surplusExplanation).toBe("Surplus 30% (delivery Thu)");
    expect(thu.surplusDeliveryDate).toBe("2026-10-15");
    expect(suggestedPacks(thu, 4)).toBe(4);
  });
  it("a blank day falls back to the normal %", () => {
    const line = { ...chicken, surplusByDeliveryWeekday: { 1: 130 } };
    const tue = withDeliverySurplus(line, new Date(2026, 9, 13));
    expect(tue.surplusPercentApplied).toBe(30);
    expect(tue.surplusExplanation).toBe("Surplus 30%");
  });
  it("lines without the setting are returned untouched", () => {
    const plain = { ...chicken, surplusByDeliveryWeekday: null, surplusTarget: 0.95 };
    expect(surplusDependsOnDeliveryDay(plain)).toBe(false);
    expect(withDeliverySurplus(plain, new Date(2026, 9, 15))).toBe(plain);
    const kanbanOnly: SurplusLineFields = { totalRequired: 0, surplusTarget: 0, packWeight: 1, isKanban: true };
    expect(withDeliverySurplus(kanbanOnly, new Date(2026, 9, 15))).toBe(kanbanOnly);
  });
});
