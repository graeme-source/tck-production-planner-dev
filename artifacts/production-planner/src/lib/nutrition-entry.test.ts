import { describe, it, expect } from "vitest";
import {
  blankNutritionFields,
  fillBlankNutritionWithZero,
  isNutritionBlank,
  nutritionInputToValue,
  shouldOfferFillBlanks,
} from "./nutrition-entry";
import { buildIngredientPayload, emptyIngredientFormDefaults, ingredientFormSchema, ingredientToFormValues } from "./ingredient-form";
import type { Ingredient } from "@workspace/api-client-react";

// Blank vs zero nutritionals (Graeme, 22 Oct 2026): a blank box is "not
// entered" (null) and must never be saved as 0; a typed 0 is a real value
// (soy sauce) and must never be saved as null.
describe("nutrition input → stored value", () => {
  it("blank stays null", () => {
    expect(nutritionInputToValue("")).toBeNull();
    expect(nutritionInputToValue("   ")).toBeNull();
    expect(nutritionInputToValue(null)).toBeNull();
    expect(nutritionInputToValue(undefined)).toBeNull();
  });

  it("0 stays 0, including 0.00", () => {
    expect(nutritionInputToValue("0")).toBe(0);
    expect(nutritionInputToValue("0.00")).toBe(0);
    expect(nutritionInputToValue(0)).toBe(0);
    expect(nutritionInputToValue("2.5")).toBe(2.5);
  });

  it("0 is not blank", () => {
    expect(isNutritionBlank(0)).toBe(false);
    expect(isNutritionBlank("0")).toBe(false);
    expect(isNutritionBlank("")).toBe(true);
  });
});

describe("Set the blank ones to 0", () => {
  const soy = { energyKj: "250", energyKcal: "", fat: 0, saturates: null, carbohydrate: "", sugars: "", protein: "10", fibre: undefined, salt: "" };

  it("lists only the blank boxes", () => {
    expect(blankNutritionFields(soy)).toEqual(["energyKcal", "saturates", "carbohydrate", "sugars", "fibre", "salt"]);
  });

  it("fills only empty boxes and leaves typed values (including 0) alone", () => {
    expect(fillBlankNutritionWithZero(soy)).toEqual({ energyKcal: 0, saturates: 0, carbohydrate: 0, sugars: 0, fibre: 0, salt: 0 });
    expect(fillBlankNutritionWithZero({ ...soy, energyKcal: "60", saturates: "0.1", carbohydrate: 0, sugars: 0, fibre: 0, salt: 0 })).toEqual({});
  });

  it("is offered only when something is filled and something is blank", () => {
    expect(shouldOfferFillBlanks(soy)).toBe(true);
    expect(shouldOfferFillBlanks({})).toBe(false);
    const allFilled = { energyKj: 1, energyKcal: 1, fat: 0, saturates: 0, carbohydrate: 0, sugars: 0, protein: 0, fibre: 0, salt: 0 };
    expect(shouldOfferFillBlanks(allFilled)).toBe(false);
  });
});

describe("blank vs zero survives form → payload", () => {
  const base = { ...emptyIngredientFormDefaults("ingredient"), name: "Soy Sauce", unit: "L", packWeight: 1, costPerPack: 3 };

  it("'' saves as null and '0' saves as 0", () => {
    const parsed = ingredientFormSchema.parse({ ...base, fat: "0", saturates: "0.00", sugars: "", protein: "10" });
    const p = buildIngredientPayload(parsed);
    expect(p.fat).toBe(0);
    expect(p.saturates).toBe(0);
    expect(p.sugars).toBeNull();
    expect(p.protein).toBe(10);
  });

  it("negative values are still rejected", () => {
    expect(ingredientFormSchema.safeParse({ ...base, salt: "-1" }).success).toBe(false);
  });

  it("a stored 0 loads back as 0 and a stored null as blank", () => {
    const item = { id: 1, name: "Soy Sauce", unit: "L", fat: "0", sugars: null } as unknown as Ingredient;
    const v = ingredientToFormValues(item, "ingredient");
    expect(v.fat).toBe(0);
    expect(v.sugars).toBeNull();
  });
});
