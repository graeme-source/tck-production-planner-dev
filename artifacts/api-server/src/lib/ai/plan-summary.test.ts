import { describe, expect, it } from "vitest";
import { FRIED_CHICKEN_CATEGORY, MAC_CHEESE_CATEGORY } from "@workspace/production-schedule";
import { planSummaryText } from "./plan-summary";

describe("planSummaryText", () => {
  // Regression (2026-10-05): every non-mac item was summed as calzone
  // batches, so the assistant told people a 105-batch day was 259 batches.
  it("keeps fried chicken bags out of the calzone batches", () => {
    const text = planSummaryText("2026-10-05", { status: "active", name: "Mon" }, [
      { recipeName: "Margherita", recipeCategory: "Calzones", batchesTarget: 105, batchesComplete: 0, packSize: "2" },
      { recipeName: "Mac", recipeCategory: MAC_CHEESE_CATEGORY, batchesTarget: 15, batchesComplete: 0, packSize: "1" },
      { recipeName: "Korean 500g", recipeCategory: FRIED_CHICKEN_CATEGORY, batchesTarget: 154, batchesComplete: 0, packSize: "1" },
    ]);
    expect(text).toContain("- Calzones: 105 batches across 1 product.");
    expect(text).toContain("- Macaroni Cheese: 15 packs");
    expect(text).toContain(`- ${FRIED_CHICKEN_CATEGORY} (made in a separate facility, not part of the kitchen's batches): 154 bags`);
    expect(text).toContain("  - Korean 500g: 154 bags");
  });
});
