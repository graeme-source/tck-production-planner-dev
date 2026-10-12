import { describe, expect, it } from "vitest";
import { FRIED_CHICKEN_CATEGORY, MAC_CHEESE_CATEGORY, separateKitchenPositions } from "@workspace/production-schedule";
import { isSeparateKitchenPosition, meetingRotaStations, testProductPrepItems } from "./meeting-scope";

describe("testProductPrepItems", () => {
  // Regression (2026-10-12): Friday 9 Oct's "Test Product Prep" slide listed
  // Monday's four fried chicken lines (none are core menu) as test products.
  it("leaves fried chicken out even though it isn't core menu", () => {
    const items = [
      { id: 1, isCoreMenu: false, recipeCategory: FRIED_CHICKEN_CATEGORY },
      { id: 2, isCoreMenu: false, recipeCategory: "Calzones" },
      { id: 3, isCoreMenu: true, recipeCategory: "Calzones" },
      { id: 4, isCoreMenu: false, recipeCategory: MAC_CHEESE_CATEGORY },
      { id: 5, isCoreMenu: false, recipeCategory: null },
    ];
    expect(testProductPrepItems(items).map(i => i.id)).toEqual([2, 4, 5]);
  });
});

describe("meeting rota scope", () => {
  // The live setting on 12 Oct: Frying + Breading under Fried Chicken.
  const separate = separateKitchenPositions({ [FRIED_CHICKEN_CATEGORY]: ["Frying", "Breading"] });
  const mapping = [
    { title: "Ovens", positions: ["Ovens"] },
    { title: "Fried Chicken", positions: ["Frying", "Breading"] },
    { title: "Mixed", positions: ["Frying", "Wrapper"] },
    { title: "Empty", positions: [] },
  ];

  it("drops a station staffed only by separate-facility positions", () => {
    expect(meetingRotaStations(mapping, separate).map(s => s.title)).toEqual(["Ovens", "Mixed", "Empty"]);
  });

  it("recognises separate-facility shifts whatever the case or spacing", () => {
    expect(isSeparateKitchenPosition(" frying ", separate)).toBe(true);
    expect(isSeparateKitchenPosition("BREADING", separate)).toBe(true);
    expect(isSeparateKitchenPosition("Ovens", separate)).toBe(false);
    expect(isSeparateKitchenPosition(null, separate)).toBe(false);
  });
});
