import { describe, it, expect } from "vitest";
import { dismissalStillHolds, driftAllowance, reviewTodoTitle } from "./timing-review-rules";

describe("dismissing a suggested timing (Graeme, 2026-10-15)", () => {
  it("holds while the set value and the suggestion are unchanged", () => {
    expect(dismissalStillHolds("cook", { setValue: 30, suggestedValue: 24 }, { setValue: 30, suggestedValue: 24 })).toBe(true);
  });
  it("small drift in the oven history doesn't bring it back", () => {
    expect(dismissalStillHolds("cook", { setValue: 30, suggestedValue: 24 }, { setValue: 30, suggestedValue: 26 })).toBe(true);
  });
  it("comes back when the suggestion moves well away", () => {
    expect(dismissalStillHolds("cook", { setValue: 30, suggestedValue: 24 }, { setValue: 30, suggestedValue: 19 })).toBe(false);
  });
  it("comes back when someone changes the set value", () => {
    expect(dismissalStillHolds("cook", { setValue: 30, suggestedValue: 24 }, { setValue: 28, suggestedValue: 24 })).toBe(false);
  });
  it("build times allow at least 30 s or 10%", () => {
    expect(driftAllowance("build", 120)).toBe(30);
    expect(driftAllowance("build", 600)).toBe(60);
    expect(dismissalStillHolds("build", { setValue: 300, suggestedValue: 360 }, { setValue: 300, suggestedValue: 390 })).toBe(true);
    expect(dismissalStillHolds("build", { setValue: 300, suggestedValue: 360 }, { setValue: 300, suggestedValue: 420 })).toBe(false);
  });
  it("a suggestion appearing or disappearing brings it back", () => {
    expect(dismissalStillHolds("cook", { setValue: 30, suggestedValue: null }, { setValue: 30, suggestedValue: 24 })).toBe(false);
    expect(dismissalStillHolds("cook", { setValue: 30, suggestedValue: 24 }, { setValue: 30, suggestedValue: null })).toBe(false);
  });
  it("names the item and both numbers in the to-do", () => {
    expect(reviewTodoTitle("cook", "Diced Chicken", 30, 24)).toBe("Review cook time: Diced Chicken — set 30 min, the ovens say 24 min");
    expect(reviewTodoTitle("build", "Carnizone", 300, 352)).toBe("Review build time: Carnizone — set 5 min, the floor says 5 min 52 s");
  });
});
