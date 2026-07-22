import * as z from "zod";
import type { Ingredient } from "@workspace/api-client-react";

// Shared form schema covering every field either ingredient-edit dialog needs
// (both Ingredients page and Inventory page). A superset keeps the two forms
// from drifting when a new column is added — default and populate helpers
// handle *every* field so unrendered fields round-trip cleanly through edit/save.

const nullableNumber = (check: (s: z.ZodNumber) => z.ZodNumber = (s) => s) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    check(z.number()).nullable().optional(),
  );

// Ingredients (food items used in recipes) must always use a native weight,
// volume, or count unit — packs/bottles/bags only appear in stock check,
// ordering, receiving and storage UIs, converted via pack size. Non-ingredient
// supplies can still use packaging-style units (box, roll, sheet, etc.).
export const NATIVE_INGREDIENT_UNITS = ["g", "kg", "ml", "l", "L", "pieces"] as const;
const NATIVE_INGREDIENT_UNIT_SET = new Set<string>(NATIVE_INGREDIENT_UNITS);

export const ingredientFormSchema = z.object({
  // Mode tab (inventory page only — ingredients page pins this to "ingredient").
  formMode: z.enum(["ingredient", "supply"]).optional(),

  // Core
  name: z.string().min(1, "Name is required"),
  unit: z.string().min(1, "Unit is required"),
  packWeight: z.coerce.number().min(0, "Must be positive"),
  costPerPack: z.coerce.number().min(0, "Must be positive"),

  brand: z.string().optional(),
  supplierPartNumber: z.string().optional(),
  supplierId: z.coerce.number().optional(),
  secondarySupplierId: z.coerce.number().optional(),
  orderingUrl: z.string().optional(),
  notes: z.string().optional(),
  category: z.string().optional(),

  // Prep behaviour
  prepWeightMode: z.enum(["raw", "processed"]).optional(),
  palletSize: nullableNumber((n) => n.int().positive()),
  processingRatioPct: nullableNumber((n) => n.min(0).max(100)),
  rawMeatTrayCapacityKg: nullableNumber((n) => n.positive()),
  minCookingTempC: nullableNumber((n) => n.min(0).max(300)),
  estimatedCookTimeMin: nullableNumber((n) => n.int().min(1)),
  meatProcessMinutes: nullableNumber((n) => n.int().min(1)),
  ovenTempC: nullableNumber((n) => n.int().min(0).max(500)),
  steamPct: nullableNumber((n) => n.int().min(0).max(100)),

  // Packaging shape
  isBottle: z.boolean().optional(),
  bottleSize: nullableNumber((n) => n.min(0)),
  prepCountPerPortion: nullableNumber((n) => n.int().positive()),
  isPasta: z.boolean().optional(),
  // When true, stock check / orders / goods-in all operate in whole packs.
  // Prep and recipes continue to use the native unit. Requires packWeight > 0.
  stockInPacks: z.boolean().optional(),

  // Stock / ordering
  stockCheckEnabled: z.boolean().optional(),
  stockCheckFrequency: z.enum(["daily", "weekly"]).optional(),
  stockCheckDay: z.string().optional(),
  surplusPercent: z.coerce.number().min(0).optional(),
  surplusMode: z.enum(["percent", "absolute"]).optional(),
  surplusAbsoluteQty: nullableNumber((n) => n.min(0)),
  shelfLifeDays: nullableNumber((n) => n.int().positive()),
  requiresUseByDate: z.boolean().optional(),
  // Packs per supplier case. When set, the orders page rounds the pack count to
  // order up to the nearest whole case. Empty = order in individual packs.
  caseSizePacks: nullableNumber((n) => n.int().positive()),

  // Kanban
  kanbanEnabled: z.boolean().optional(),
  kanbanQuantity: z.coerce.number().min(0).optional(),
  kanbanUnit: z.enum(["weight", "pack", "bottle", "pallet"]).optional(),
  kanbanOrderAmount: nullableNumber((n) => n.min(0)),
  // Shopify inventory link — goods-in pushes received stock to this variant.
  shopifyVariantId: z.string().optional(),
  shopifyProductTitle: z.string().optional(),
  shopifyVariantTitle: z.string().optional(),
  shopifyUnitsPerPack: nullableNumber((n) => n.positive()),

  // Nutritionals
  energyKj: nullableNumber((n) => n.min(0)),
  energyKcal: nullableNumber((n) => n.min(0)),
  fat: nullableNumber((n) => n.min(0)),
  saturates: nullableNumber((n) => n.min(0)),
  carbohydrate: nullableNumber((n) => n.min(0)),
  sugars: nullableNumber((n) => n.min(0)),
  protein: nullableNumber((n) => n.min(0)),
  fibre: nullableNumber((n) => n.min(0)),
  salt: nullableNumber((n) => n.min(0)),
  labelDeclaration: z.string().optional(),
  allergens: z.array(z.string()).optional(),
  // True when per-100g values came from the AI estimate flow. Cleared
  // back to false when the operator manually edits a nutritional field
  // after the AI fill (handled in the dialog layer).
  nutritionalsAiEstimated: z.boolean().optional(),
  // NOVA class 1-4 (4 = UPF), null = unclassified. Changing it in the form
  // saves a manual override; the server only flips it to 'manual' when the
  // value actually differs from what's stored.
  novaClass: z.number().int().min(1).max(4).nullable().optional(),
}).superRefine((val, ctx) => {
  // Ingredient-mode entries must use a native weight/volume/count unit.
  // Supplies can use packaging-style units.
  const isIngredient = val.formMode !== "supply";
  if (isIngredient && !NATIVE_INGREDIENT_UNIT_SET.has(val.unit)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unit"],
      message: "Ingredients must use kg, g, L, ml or pieces. Packs and bottles are captured via Pack size.",
    });
  }
  // "Count stock in whole packs" needs a pack size, otherwise the pack <->
  // native conversion divides by zero and UIs can't render anything useful.
  if (val.stockInPacks === true && (!val.packWeight || val.packWeight <= 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["stockInPacks"],
      message: "Set a Pack size greater than 0 before turning on 'Count stock in whole packs'.",
    });
  }
});

export type IngredientFormValues = z.infer<typeof ingredientFormSchema>;

export function emptyIngredientFormDefaults(
  mode: "ingredient" | "supply" = "ingredient",
): IngredientFormValues {
  return {
    formMode: mode,
    name: "",
    unit: mode === "supply" ? "each" : "kg",
    packWeight: 0,
    costPerPack: 0,
    brand: "",
    supplierPartNumber: "",
    supplierId: 0,
    secondarySupplierId: 0,
    orderingUrl: "",
    notes: "",
    category: "",
    prepWeightMode: "raw" as const,
    palletSize: null,
    processingRatioPct: null,
    rawMeatTrayCapacityKg: null,
    minCookingTempC: null,
    estimatedCookTimeMin: null,
    meatProcessMinutes: null,
    ovenTempC: null,
    steamPct: null,
    isBottle: false,
    bottleSize: null,
    prepCountPerPortion: null,
    isPasta: false,
    stockInPacks: false,
    stockCheckEnabled: false,
    stockCheckFrequency: "daily",
    stockCheckDay: "",
    surplusPercent: 10,
    surplusMode: "percent" as const,
    surplusAbsoluteQty: null,
    shelfLifeDays: null,
    requiresUseByDate: false,
    caseSizePacks: null,
    kanbanEnabled: false,
    kanbanQuantity: 0,
    kanbanUnit: "weight" as const,
    kanbanOrderAmount: null,
    shopifyVariantId: "",
    shopifyProductTitle: "",
    shopifyVariantTitle: "",
    shopifyUnitsPerPack: null,
    energyKj: null,
    energyKcal: null,
    fat: null,
    saturates: null,
    carbohydrate: null,
    sugars: null,
    protein: null,
    fibre: null,
    salt: null,
    labelDeclaration: "",
    allergens: [],
    nutritionalsAiEstimated: false,
    novaClass: null,
  };
}

// The generated `Ingredient` type only declares a subset of real columns.
// Cast through Record so we can safely read fields the generated type doesn't
// list. Runtime-safe: any missing field falls through to the default.
type AnyIngredient = Ingredient & Record<string, unknown>;

function num(v: unknown): number | null {
  return v == null ? null : Number(v);
}
function str(v: unknown, fallback = ""): string {
  return (v as string | null | undefined) ?? fallback;
}
function bool(v: unknown, fallback = false): boolean {
  return (v as boolean | null | undefined) ?? fallback;
}

export function ingredientToFormValues(
  item: Ingredient,
  mode: "ingredient" | "supply" = "ingredient",
): IngredientFormValues {
  const it = item as AnyIngredient;
  return {
    formMode: it.perishable === false ? "supply" : mode,
    name: item.name,
    unit: item.unit,
    packWeight: Number(item.packWeight),
    costPerPack: Number(item.costPerPack),
    brand: item.brand ?? "",
    supplierPartNumber: item.supplierPartNumber ?? "",
    supplierId: item.supplierId ?? 0,
    secondarySupplierId: item.secondarySupplierId ?? 0,
    orderingUrl: item.orderingUrl ?? "",
    notes: item.notes ?? "",
    category: item.category ?? "",
    prepWeightMode: (it.prepWeightMode as "raw" | "processed" | undefined) ?? "raw",
    palletSize: num(it.palletSize),
    processingRatioPct:
      item.processingRatio != null
        ? parseFloat((Number(item.processingRatio) * 100).toFixed(4))
        : null,
    rawMeatTrayCapacityKg: num(item.rawMeatTrayCapacityKg),
    minCookingTempC: num(it.minCookingTempC),
    estimatedCookTimeMin: num(it.estimatedCookTimeMin),
    meatProcessMinutes: num(it.meatProcessMinutes),
    ovenTempC: num(it.ovenTempC),
    steamPct: num(it.steamPct),
    isBottle: bool(it.isBottle),
    bottleSize: num(it.bottleSize),
    prepCountPerPortion: num(it.prepCountPerPortion),
    isPasta: bool(it.isPasta),
    stockInPacks: bool(it.stockInPacks),
    stockCheckEnabled: bool(it.stockCheckEnabled),
    stockCheckFrequency: (it.stockCheckFrequency as "daily" | "weekly" | undefined) ?? "daily",
    stockCheckDay: str(it.stockCheckDay),
    surplusPercent: num(it.surplusPercent) ?? 10,
    surplusMode: (it.surplusMode as "percent" | "absolute" | undefined) ?? "percent",
    surplusAbsoluteQty: num(it.surplusAbsoluteQty),
    shelfLifeDays: num(it.shelfLifeDays),
    requiresUseByDate: bool(it.requiresUseByDate),
    caseSizePacks: num(it.caseSizePacks),
    kanbanEnabled: bool(it.kanbanEnabled),
    kanbanQuantity: num(it.kanbanQuantity) ?? 0,
    kanbanUnit: (it.kanbanUnit as "weight" | "pack" | "bottle" | undefined) ?? "weight",
    kanbanOrderAmount: num(it.kanbanOrderAmount),
    shopifyVariantId: str(it.shopifyVariantId),
    shopifyProductTitle: str(it.shopifyProductTitle),
    shopifyVariantTitle: str(it.shopifyVariantTitle),
    shopifyUnitsPerPack: num(it.shopifyUnitsPerPack),
    energyKj: num(it.energyKj),
    energyKcal: num(it.energyKcal),
    fat: num(it.fat),
    saturates: num(it.saturates),
    carbohydrate: num(it.carbohydrate),
    sugars: num(it.sugars),
    protein: num(it.protein),
    fibre: num(it.fibre),
    salt: num(it.salt),
    labelDeclaration: str(it.labelDeclaration),
    allergens: (it.allergens as string[] | null | undefined) ?? [],
    nutritionalsAiEstimated: bool(it.nutritionalsAiEstimated),
    novaClass: num(it.novaClass),
  };
}

// Build the payload for POST /api/ingredients or PUT /api/ingredients/:id.
// Every column the server knows about is set here so Create and Update paths
// are symmetrical and fields can't go silently missing from one call site.
export function buildIngredientPayload(data: IngredientFormValues) {
  const isIngredient = data.formMode !== "supply";
  return {
    name: data.name,
    unit: data.unit,
    packWeight: data.packWeight,
    costPerPack: data.costPerPack,
    brand: data.brand || null,
    supplierPartNumber: data.supplierPartNumber || null,
    supplierId: data.supplierId && data.supplierId > 0 ? data.supplierId : null,
    secondarySupplierId:
      data.secondarySupplierId && data.secondarySupplierId > 0 ? data.secondarySupplierId : null,
    orderingUrl: data.orderingUrl || null,
    notes: data.notes || null,
    category: data.category || null,
    perishable: isIngredient,
    prepWeightMode: data.prepWeightMode ?? "raw",
    palletSize: data.palletSize ?? null,
    processingRatio: data.processingRatioPct != null ? data.processingRatioPct / 100 : null,
    rawMeatTrayCapacityKg: data.rawMeatTrayCapacityKg ?? null,
    minCookingTempC: data.minCookingTempC ?? null,
    estimatedCookTimeMin: data.estimatedCookTimeMin ?? null,
    meatProcessMinutes: data.meatProcessMinutes ?? null,
    ovenTempC: data.ovenTempC ?? null,
    steamPct: data.steamPct ?? null,
    isBottle: data.isBottle ?? false,
    bottleSize: data.isBottle ? (data.bottleSize ?? null) : null,
    prepCountPerPortion: data.prepCountPerPortion ?? null,
    isPasta: data.isPasta ?? false,
    stockInPacks: data.stockInPacks ?? false,
    stockCheckEnabled: data.stockCheckEnabled ?? false,
    stockCheckFrequency: data.stockCheckFrequency ?? "daily",
    stockCheckDay:
      data.stockCheckFrequency === "weekly" ? (data.stockCheckDay || null) : null,
    surplusPercent: data.surplusPercent ?? 10,
    surplusMode: data.surplusMode ?? "percent",
    surplusAbsoluteQty:
      data.surplusMode === "absolute" ? (data.surplusAbsoluteQty ?? null) : null,
    shelfLifeDays: data.shelfLifeDays ?? null,
    requiresUseByDate: data.requiresUseByDate ?? false,
    caseSizePacks: data.caseSizePacks ?? null,
    kanbanEnabled: data.kanbanEnabled ?? false,
    kanbanQuantity: data.kanbanQuantity ?? 0,
    kanbanUnit: data.kanbanUnit ?? "weight",
    kanbanOrderAmount: data.kanbanOrderAmount ?? null,
    shopifyVariantId: data.shopifyVariantId || null,
    shopifyProductTitle: data.shopifyProductTitle || null,
    shopifyVariantTitle: data.shopifyVariantTitle || null,
    shopifyUnitsPerPack: data.shopifyUnitsPerPack ?? null,
    energyKj: data.energyKj ?? null,
    energyKcal: data.energyKcal ?? null,
    fat: data.fat ?? null,
    saturates: data.saturates ?? null,
    carbohydrate: data.carbohydrate ?? null,
    sugars: data.sugars ?? null,
    protein: data.protein ?? null,
    fibre: data.fibre ?? null,
    salt: data.salt ?? null,
    labelDeclaration: data.labelDeclaration || null,
    allergens: data.allergens ?? [],
    nutritionalsAiEstimated: data.nutritionalsAiEstimated ?? false,
    novaClass: data.novaClass ?? null,
  };
}
