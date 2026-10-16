import { describe, it, expect } from "vitest";
import { buildIngredientPayload, emptyIngredientFormDefaults, ingredientFormSchema } from "./ingredient-form";

// Secondary supplier price (2026-10-01): optional, and only sent while a
// secondary supplier is chosen.
describe("secondary supplier price", () => {
  const base = { ...emptyIngredientFormDefaults("ingredient"), name: "Double Cream", unit: "L", packWeight: 2, costPerPack: 6.2 };

  it("is sent when a secondary supplier is chosen", () => {
    const p = buildIngredientPayload({ ...base, secondarySupplierId: 4, secondaryCostPerPack: 7.35 });
    expect(p.secondarySupplierId).toBe(4);
    expect(p.secondaryCostPerPack).toBe(7.35);
  });

  it("is cleared when there's no secondary supplier", () => {
    const p = buildIngredientPayload({ ...base, secondarySupplierId: 0, secondaryCostPerPack: 7.35 });
    expect(p.secondarySupplierId).toBeNull();
    expect(p.secondaryCostPerPack).toBeNull();
  });

  it("blank means not known; negatives are rejected", () => {
    expect(ingredientFormSchema.safeParse({ ...base, secondaryCostPerPack: "" }).data?.secondaryCostPerPack).toBeNull();
    expect(ingredientFormSchema.safeParse({ ...base, secondaryCostPerPack: "-1" }).success).toBe(false);
  });
});

// Minimum shelf life on delivery (2026-10-16): optional whole days.
describe("minimum shelf life on delivery", () => {
  const base = { ...emptyIngredientFormDefaults("ingredient"), name: "Diced Chicken", unit: "kg", packWeight: 5, costPerPack: 30 };

  it("defaults to none and is sent as null", () => {
    expect(base.minDeliveryShelfLifeDays).toBeNull();
    expect(buildIngredientPayload(base).minDeliveryShelfLifeDays).toBeNull();
  });

  it("is sent when set", () => {
    const parsed = ingredientFormSchema.safeParse({ ...base, minDeliveryShelfLifeDays: "3" });
    expect(parsed.success).toBe(true);
    expect(buildIngredientPayload(parsed.data!).minDeliveryShelfLifeDays).toBe(3);
  });

  it("blank clears it; zero, fractions and negatives are rejected", () => {
    expect(ingredientFormSchema.safeParse({ ...base, minDeliveryShelfLifeDays: "" }).data?.minDeliveryShelfLifeDays).toBeNull();
    expect(ingredientFormSchema.safeParse({ ...base, minDeliveryShelfLifeDays: "0" }).success).toBe(false);
    expect(ingredientFormSchema.safeParse({ ...base, minDeliveryShelfLifeDays: "1.5" }).success).toBe(false);
    expect(ingredientFormSchema.safeParse({ ...base, minDeliveryShelfLifeDays: "-2" }).success).toBe(false);
  });
});
