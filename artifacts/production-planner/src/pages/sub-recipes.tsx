import { useState, useEffect, useRef } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useListSubRecipes, useListIngredients, useGetSubRecipe } from "@workspace/api-client-react";
import type { Ingredient, SubRecipeDetail, SubRecipe } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { QuickAddIngredientDialog } from "@/components/quick-add-ingredient";
import { IngredientCombobox } from "@/components/ingredient-combobox";
import { Search, Plus, Trash2, BookOpen, X, Edit2, Loader2, AlertTriangle, CheckCircle2, RotateCcw, FlaskConical, Info, Layers, Eye, Target, Minus, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { useForm, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { NumberInput } from "@/components/ui/number-input";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  yield: z.coerce.number().min(0.01, "Must be > 0"),
  yieldUnit: z.string().min(1, "Unit required"),
  notes: z.string().optional(),
  shelfLifeDays: z.coerce.number().int().nonnegative().optional(),
  isBase: z.boolean().optional(),
  expandInPrep: z.boolean().optional(),
  labelDeclaration: z.string().optional(),
  ingredients: z.array(z.object({
    ingredientId: z.coerce.number().min(1, "Select an ingredient"),
    quantity: z.coerce.number().min(0.001, "Must be > 0"),
    hideFromPrep: z.boolean().optional(),
  })).min(0),
  subRecipeComponents: z.array(z.object({
    componentSubRecipeId: z.coerce.number().min(1, "Select a sub-recipe"),
    quantity: z.coerce.number().min(0.001, "Must be > 0"),
  })).min(0),
}).refine(
  (data) => data.ingredients.length > 0 || data.subRecipeComponents.length > 0,
  { message: "Add at least one ingredient or sub-recipe component", path: ["ingredients"] }
);

type FormValues = z.infer<typeof schema>;

type IngredientOption = Pick<Ingredient, "id" | "name" | "unit" | "processingRatio">;
type SubRecipeOption = Pick<SubRecipe, "id" | "name" | "yieldUnit">;

function toKg(value: number | string | null | undefined, unit: string): number | null {
  const n = Number(value);
  if (!isFinite(n)) return null;
  if (unit === "kg") return n;
  if (unit === "g") return n / 1000;
  return null;
}

function computeProcessedKg(
  rows: { ingredientId: number; quantity: number }[],
  allIngredients: IngredientOption[],
): number {
  let total = 0;
  for (const row of rows) {
    const ing = allIngredients.find(i => i.id === Number(row.ingredientId));
    if (!ing || !row.quantity) continue;
    if (ing.unit === "kg") total += Number(row.quantity);
    else if (ing.unit === "g") total += Number(row.quantity) / 1000;
  }
  return total;
}

function computeComponentKg(
  rows: { componentSubRecipeId: number; quantity: number }[],
  allSubRecipes: SubRecipeOption[],
): number {
  let total = 0;
  for (const row of rows) {
    const sr = allSubRecipes.find(s => s.id === Number(row.componentSubRecipeId));
    if (!sr || !row.quantity) continue;
    if (sr.yieldUnit === "kg") total += Number(row.quantity);
    else if (sr.yieldUnit === "g") total += Number(row.quantity) / 1000;
  }
  return total;
}

function YieldSanityCheck({
  ingredientRows,
  allIngredients,
  componentRows,
  allSubRecipes,
  yieldValue,
  yieldUnit,
}: {
  ingredientRows: { ingredientId: number; quantity: number }[];
  allIngredients: IngredientOption[];
  componentRows: { componentSubRecipeId: number; quantity: number }[];
  allSubRecipes: SubRecipeOption[];
  yieldValue: number;
  yieldUnit: string;
}) {
  let cookedKg = 0;
  let allWeight = true;

  for (const row of ingredientRows) {
    const ing = allIngredients.find(i => i.id === row.ingredientId);
    if (!ing) continue;
    if (ing.unit === "kg") cookedKg += Number(row.quantity);
    else if (ing.unit === "g") cookedKg += Number(row.quantity) / 1000;
    else { allWeight = false; continue; }
  }

  const componentKg = computeComponentKg(componentRows, allSubRecipes);
  cookedKg += componentKg;

  if (cookedKg === 0) return null;
  const yieldKg = toKg(yieldValue, yieldUnit);
  if (yieldKg === null) return null;

  const ratio = yieldKg / cookedKg;
  const pct = (ratio * 100).toFixed(0);
  const ok = ratio >= 0.5 && ratio <= 1.05;
  const warning = !ok;

  return (
    <div className={`rounded-lg px-3.5 py-2.5 text-sm flex items-start gap-2.5 ${warning ? "bg-amber-50 border border-amber-200 text-amber-800" : "bg-green-50 border border-green-200 text-green-800"}`}>
      {warning
        ? <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        : <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
      }
      <div>
        <span className="font-medium">
          {`${allWeight ? "" : "Weight-only ingredients: "}Cooked input ${cookedKg.toFixed(3)} kg → Yield ${yieldKg.toFixed(3)} kg (${pct}% retention)`}
        </span>
        {warning && (
          <p className="text-xs mt-0.5">
            {ratio < 0.5
              ? "Yield looks low vs inputs — did you mean a larger yield? (e.g. a batch of " + cookedKg.toFixed(1) + " kg)"
              : "Yield exceeds cooked input weight — please check ingredient quantities or yield value."}
          </p>
        )}
      </div>
    </div>
  );
}

function YieldComparison({
  detail,
}: {
  detail: SubRecipeDetail;
}) {
  const storedYieldKg = toKg(Number(detail.yield), detail.yieldUnit);

  let expectedKg = 0;
  let canCompare = storedYieldKg !== null;
  for (const i of detail.ingredients) {
    if (i.unit === "kg") expectedKg += i.quantity;
    else if (i.unit === "g") expectedKg += i.quantity / 1000;
  }
  for (const c of (detail.subRecipeComponents ?? [])) {
    if (c.componentYieldUnit === "kg") expectedKg += c.quantity;
    else if (c.componentYieldUnit === "g") expectedKg += c.quantity / 1000;
  }

  const diffPct = (canCompare && expectedKg > 0)
    ? Math.abs(storedYieldKg! - expectedKg) / expectedKg * 100
    : 0;
  const hasMismatch = canCompare && expectedKg > 0 && diffPct > 2;

  const totalCost = detail.totalBatchCost ?? 0;
  const costPerUnit = detail.costPerYieldUnit ?? null;
  const hasCost = totalCost > 0;
  const hasNested = (detail.subRecipeComponents ?? []).length > 0;

  return (
    <div className="space-y-2 mb-4">
      {hasCost && (
        <div className="rounded-lg px-3.5 py-2.5 text-sm border bg-primary/5 border-primary/20">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium">Cost summary</span>
              {hasNested && (
                <span className="text-xs text-muted-foreground">(includes nested sub-recipes)</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-6 ml-1">
              <div>
                <span className="text-xs text-muted-foreground block">Total batch cost</span>
                <span className="font-semibold tabular-nums text-primary">£{totalCost.toFixed(2)}</span>
              </div>
              {costPerUnit !== null && (
                <div>
                  <span className="text-xs text-muted-foreground block">Cost per {detail.yieldUnit}</span>
                  <span className="font-bold tabular-nums text-primary text-base">£{costPerUnit.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>
          {hasNested && (
            <div className="mt-2 pt-2 border-t border-primary/10 space-y-1">
              {(detail.subRecipeComponents ?? []).map(c => (
                <div key={c.id} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Layers className="w-3 h-3" />
                    {c.componentSubRecipeName ?? `SR-${c.componentSubRecipeId}`}
                    <span className="text-muted-foreground/60">× {c.quantity} {c.componentYieldUnit}</span>
                  </span>
                  <span className="tabular-nums">£{c.lineCost.toFixed(3)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {canCompare && expectedKg > 0 && (
        <div className={`rounded-lg px-3.5 py-2.5 text-sm border ${hasMismatch ? "bg-amber-50 border-amber-200" : "bg-secondary/20 border-border"}`}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              {hasMismatch
                ? <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                : <Info className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              }
              <span className="text-xs text-muted-foreground font-medium">Yield analysis</span>
            </div>
            <div className="flex flex-wrap items-center gap-6 ml-1">
              <div>
                <span className="text-xs text-muted-foreground block">Stored yield</span>
                <span className="font-semibold tabular-nums">{detail.yield} {detail.yieldUnit}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block flex items-center gap-1">
                  <FlaskConical className="w-3 h-3 inline" /> Expected from cooked inputs
                </span>
                <span className="font-semibold tabular-nums">{expectedKg.toFixed(3)} kg</span>
              </div>
              {hasMismatch && (
                <div className="text-amber-700 text-xs max-w-[200px]">
                  {diffPct.toFixed(1)}% difference — consider updating the stored yield to match the calculated expected.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SubRecipeForm({
  defaultValues,
  onSubmit,
  isPending,
  isEdit,
  ingredients: initialIngredients,
  subRecipes: allSubRecipes,
  cyclicIds,
  onDirtyChange,
  submitRef,
}: {
  defaultValues: FormValues;
  onSubmit: (data: FormValues) => void;
  isPending: boolean;
  isEdit: boolean;
  ingredients: IngredientOption[];
  subRecipes: SubRecipeOption[];
  cyclicIds?: number[];
  onDirtyChange?: (isDirty: boolean) => void;
  submitRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const { register, control, handleSubmit, setValue, watch, formState: { errors, isDirty } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  const { fields: ingFields, append: appendIng, remove: removeIng } = useFieldArray({ control, name: "ingredients" });
  const { fields: srFields, append: appendSr, remove: removeSr } = useFieldArray({ control, name: "subRecipeComponents" });

  const [localIngredients, setLocalIngredients] = useState<IngredientOption[]>(initialIngredients);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTargetIndex, setQuickAddTargetIndex] = useState<number | null>(null);
  const [isYieldAuto, setIsYieldAuto] = useState(!isEdit);
  const yieldInputRef = useRef<HTMLInputElement | null>(null);
  const [ingDisplayUnits, setIngDisplayUnits] = useState<Record<number, "g" | "kg">>({});
  const [srDisplayUnits, setSrDisplayUnits] = useState<Record<number, "g" | "kg">>({});

  const watchedIngredients = watch("ingredients");
  const watchedSubRecipeComponents = watch("subRecipeComponents");
  const watchedYield = watch("yield");
  const watchedYieldUnit = watch("yieldUnit");

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (submitRef) {
      submitRef.current = handleSubmit(onSubmit);
    }
  }, [submitRef, handleSubmit, onSubmit]);

  const availableSubRecipes = cyclicIds
    ? allSubRecipes.filter(sr => !cyclicIds.includes(sr.id))
    : allSubRecipes;

  useEffect(() => {
    if (!isYieldAuto) return;
    if (watchedYieldUnit !== "kg" && watchedYieldUnit !== "g") return;
    const totalKg = computeProcessedKg(watchedIngredients ?? [], localIngredients)
      + computeComponentKg(watchedSubRecipeComponents ?? [], allSubRecipes);
    if (totalKg <= 0) return;
    const autoValue = watchedYieldUnit === "g"
      ? parseFloat((totalKg * 1000).toFixed(1))
      : parseFloat(totalKg.toFixed(3));
    setValue("yield", autoValue, { shouldValidate: false });
  }, [watchedIngredients, watchedSubRecipeComponents, isYieldAuto, watchedYieldUnit, localIngredients, allSubRecipes, setValue]);

  const resetToAuto = () => {
    setIsYieldAuto(true);
    const totalKg = computeProcessedKg(watchedIngredients ?? [], localIngredients)
      + computeComponentKg(watchedSubRecipeComponents ?? [], allSubRecipes);
    if (totalKg > 0) {
      const autoValue = watchedYieldUnit === "g"
        ? parseFloat((totalKg * 1000).toFixed(1))
        : parseFloat(totalKg.toFixed(3));
      setValue("yield", autoValue, { shouldValidate: false });
    }
  };

  const openQuickAdd = (index: number) => {
    setQuickAddTargetIndex(index);
    setQuickAddOpen(true);
  };

  const handleIngredientCreated = (ingredient: { id: number; name: string; unit: string }) => {
    const newOpt: IngredientOption = { id: ingredient.id, name: ingredient.name, unit: ingredient.unit, processingRatio: null };
    setLocalIngredients(prev => [...prev, newOpt]);
    if (quickAddTargetIndex !== null) {
      setValue(`ingredients.${quickAddTargetIndex}.ingredientId`, ingredient.id);
    }
    setQuickAddTargetIndex(null);
  };

  const hasAnyRatio = (watchedIngredients ?? []).some(row => {
    const ing = localIngredients.find(i => i.id === Number(row.ingredientId));
    return ing?.processingRatio != null && ing.processingRatio < 1;
  });

  return (
    <>
      <QuickAddIngredientDialog open={quickAddOpen} onOpenChange={setQuickAddOpen} onCreated={handleIngredientCreated} />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 mt-4">
        <div>
          <label className="text-sm font-medium mb-1 block">Name</label>
          <input
            {...register("name")}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="e.g. Calzone Dough"
          />
          {errors.name && <span className="text-destructive text-xs">{errors.name.message}</span>}
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">Description (optional)</label>
          <textarea
            {...register("description")}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[48px] resize-none"
            placeholder="Brief description..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium">Batch Yield *</label>
              {isYieldAuto ? (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary flex items-center gap-1">
                  {hasAnyRatio && <FlaskConical className="w-3 h-3" />}
                  {hasAnyRatio ? "Auto (ratio-adjusted)" : "Auto"}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={resetToAuto}
                  className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" /> Reset to auto
                </button>
              )}
            </div>
            <input
              type="number"
              step="0.001"
              {...register("yield")}
              ref={(el) => {
                register("yield").ref(el);
                yieldInputRef.current = el;
              }}
              onChange={(e) => {
                register("yield").onChange(e);
                setIsYieldAuto(false);
              }}
              className={`w-full px-3 py-2 bg-background border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 ${isYieldAuto ? "border-primary/40 bg-primary/5" : "border-border"}`}
              placeholder="e.g. 32.76"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {isYieldAuto
                ? hasAnyRatio
                  ? "Auto-calculated from ingredient quantities × processing ratios"
                  : "Tracking total ingredient weight — edit to override"
                : "Manual override — type a lower value for processing reduction"}
            </p>
            {errors.yield && <span className="text-destructive text-xs">{errors.yield.message}</span>}
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Yield Unit *</label>
            <input
              {...register("yieldUnit")}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="kg, L, portions"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Shelf Life (days)</label>
            <input
              type="number"
              step="1"
              min="0"
              {...register("shelfLifeDays")}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="e.g. 3"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 py-1">
          <input
            type="checkbox"
            id="isBase"
            {...register("isBase")}
            className="w-4 h-4 rounded border-border accent-primary"
          />
          <div>
            <label htmlFor="isBase" className="text-sm font-medium cursor-pointer">Base sub-recipe</label>
            <p className="text-xs text-muted-foreground">Bases (sauces, dough) are managed in the Bases & Sauces station. Non-base sub-recipes appear in the ad-hoc Replenish flow.</p>
          </div>
        </div>

        <div className="flex items-center gap-3 py-1">
          <input
            type="checkbox"
            id="expandInPrep"
            {...register("expandInPrep")}
            className="w-4 h-4 rounded border-border accent-primary"
          />
          <div>
            <label htmlFor="expandInPrep" className="text-sm font-medium cursor-pointer">Show individual ingredients in prep</label>
            <p className="text-xs text-muted-foreground">When enabled, the prep station shows each ingredient separately instead of a single sub-recipe line.</p>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Label Declaration Name</label>
          <input
            {...register("labelDeclaration")}
            placeholder="e.g. Tomato Sauce — used as compound ingredient name on labels"
            className="w-full mt-1 px-3 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <p className="text-xs text-muted-foreground mt-1">If set, this name appears in the ingredient deck when this sub-recipe is listed as a compound ingredient.</p>
        </div>

        <div className="border-t border-border pt-4">
          <div className="mb-3">
            <label className="text-sm font-bold">Ingredients</label>
          </div>
          {errors.ingredients?.message && (
            <span className="text-destructive text-xs block mb-2">{errors.ingredients.message}</span>
          )}

          {ingFields.length === 0 && (
            <p className="text-xs text-muted-foreground italic py-2">No raw ingredients added yet.</p>
          )}

          {ingFields.length > 0 && (
            <div className="grid grid-cols-[1fr_120px_44px] gap-2 mb-1 px-1">
              <span className="text-xs text-muted-foreground font-medium">Ingredient</span>
              <span className="text-xs text-muted-foreground font-medium text-center">Quantity</span>
              <span />
            </div>
          )}

          <div className="space-y-2">
            {ingFields.map((field, index) => {
              const selectedId = Number(watchedIngredients?.[index]?.ingredientId ?? 0);
              const selectedIng = localIngredients.find(i => i.id === selectedId);
              const unit = selectedIng?.unit ?? "";
              const ratio = selectedIng?.processingRatio;
              return (
                <div key={field.id}>
                  <div className="grid grid-cols-[1fr_120px_44px] gap-2 items-center">
                    <IngredientCombobox
                      value={selectedId}
                      onChange={(id) => setValue(`ingredients.${index}.ingredientId`, id, { shouldValidate: true })}
                      options={localIngredients}
                      placeholder="Select ingredient..."
                      onCreateNew={() => openQuickAdd(index)}
                    />
                    {(() => {
                      const isKg = unit === "kg";
                      const displayUnit = isKg ? (ingDisplayUnits[index] ?? "g") : null;
                      const storedKg = Number(watchedIngredients?.[index]?.quantity) || 0;
                      if (!isKg) {
                        return (
                          <div className="relative">
                            <input
                              type="number"
                              step="0.001"
                              {...register(`ingredients.${index}.quantity`)}
                              className="w-full px-2 py-2 pr-7 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                              placeholder="Qty"
                            />
                            {unit && (
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                                {unit}
                              </span>
                            )}
                          </div>
                        );
                      }
                      return (
                        <div className="flex gap-0.5 items-stretch">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={storedKg === 0 ? "" : displayUnit === "g" ? Math.round(storedKg * 1000 * 100) / 100 : storedKg}
                            onChange={e => {
                              const v = e.target.value === "" ? 0 : Number(e.target.value);
                              setValue(`ingredients.${index}.quantity`, displayUnit === "g" ? v / 1000 : v, { shouldValidate: true });
                            }}
                            className="min-w-0 flex-1 w-0 px-2 py-2 bg-background border border-border rounded-l-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                            placeholder={displayUnit === "g" ? "e.g. 250" : "0.000"}
                          />
                          <div className="flex flex-col shrink-0 text-[9px] font-semibold overflow-hidden border border-l-0 border-border rounded-r-lg">
                            <button type="button" onClick={() => setIngDisplayUnits(u => ({ ...u, [index]: "g" }))} className={cn("px-1 flex-1 transition-colors", displayUnit === "g" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>g</button>
                            <button type="button" onClick={() => setIngDisplayUnits(u => ({ ...u, [index]: "kg" }))} className={cn("px-1 flex-1 border-t border-border transition-colors", displayUnit === "kg" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>kg</button>
                          </div>
                        </div>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={() => removeIng(index)}
                      className="flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {ratio != null && ratio < 1 && (
                    <div className="ml-1 mt-0.5 text-xs text-amber-600 flex items-center gap-1">
                      <FlaskConical className="w-3 h-3" />
                      Processing ratio: {(ratio * 100).toFixed(2)}% — yield adjusted from raw input
                    </div>
                  )}
                  <label className="ml-1 mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      {...register(`ingredients.${index}.hideFromPrep`)}
                      className="rounded border-border"
                    />
                    <span>Hide from prep sheet</span>
                    <span className="text-[10px] text-muted-foreground/80">
                      (keeps the quantity for ratio maths; doesn&rsquo;t show for prep)
                    </span>
                  </label>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => appendIng({ ingredientId: 0, quantity: 1 })}
            className="mt-2 w-full px-2 py-2 rounded-lg border border-dashed border-primary/40 text-primary hover:bg-primary/10 transition-colors text-xs font-medium flex items-center justify-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add ingredient to sub-recipe
          </button>

          {(ingFields.length > 0 || srFields.length > 0) && (
            <div className="mt-3">
              <YieldSanityCheck
                ingredientRows={watchedIngredients ?? []}
                allIngredients={localIngredients}
                componentRows={watchedSubRecipeComponents ?? []}
                allSubRecipes={allSubRecipes}
                yieldValue={watchedYield ?? 0}
                yieldUnit={watchedYieldUnit ?? "kg"}
              />
            </div>
          )}
        </div>

        <div className="border-t border-border pt-4">
          <div className="mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-muted-foreground" />
            <label className="text-sm font-bold">Sub-recipe Components</label>
          </div>

          {availableSubRecipes.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2">No other sub-recipes available yet.</p>
          ) : srFields.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2">No nested sub-recipes added yet.</p>
          ) : null}

          {srFields.length > 0 && (
            <div className="grid grid-cols-[1fr_120px_32px] gap-2 mb-1 px-1">
              <span className="text-xs text-muted-foreground font-medium">Sub-recipe</span>
              <span className="text-xs text-muted-foreground font-medium text-center">Quantity</span>
              <span />
            </div>
          )}

          <div className="space-y-2">
            {srFields.map((field, index) => {
              const selectedId = Number(watchedSubRecipeComponents?.[index]?.componentSubRecipeId ?? 0);
              const selectedSr = availableSubRecipes.find(sr => sr.id === selectedId);
              const unit = selectedSr?.yieldUnit ?? "";
              return (
                <div key={field.id} className="grid grid-cols-[1fr_120px_32px] gap-2 items-center">
                  <select
                    {...register(`subRecipeComponents.${index}.componentSubRecipeId`)}
                    className="px-2 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 truncate"
                  >
                    <option value={0} disabled>Select sub-recipe...</option>
                    {availableSubRecipes.map(sr => (
                      <option key={sr.id} value={sr.id}>{sr.name} ({sr.yieldUnit})</option>
                    ))}
                  </select>
                  {(() => {
                    const isKg = unit === "kg";
                    const displayUnit = isKg ? (srDisplayUnits[index] ?? "g") : null;
                    const storedKg = Number(watchedSubRecipeComponents?.[index]?.quantity) || 0;
                    if (!isKg) {
                      return (
                        <div className="relative">
                          <input
                            type="number"
                            step="0.001"
                            {...register(`subRecipeComponents.${index}.quantity`)}
                            className="w-full px-2 py-2 pr-7 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                            placeholder="Qty"
                          />
                          {unit && (
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                              {unit}
                            </span>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div className="flex gap-0.5 items-stretch">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={storedKg === 0 ? "" : displayUnit === "g" ? Math.round(storedKg * 1000 * 100) / 100 : storedKg}
                          onChange={e => {
                            const v = e.target.value === "" ? 0 : Number(e.target.value);
                            setValue(`subRecipeComponents.${index}.quantity`, displayUnit === "g" ? v / 1000 : v, { shouldValidate: true });
                          }}
                          className="min-w-0 flex-1 w-0 px-2 py-2 bg-background border border-border rounded-l-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                          placeholder={displayUnit === "g" ? "e.g. 250" : "0.000"}
                        />
                        <div className="flex flex-col shrink-0 text-[9px] font-semibold overflow-hidden border border-l-0 border-border rounded-r-lg">
                          <button type="button" onClick={() => setSrDisplayUnits(u => ({ ...u, [index]: "g" }))} className={cn("px-1 flex-1 transition-colors", displayUnit === "g" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>g</button>
                          <button type="button" onClick={() => setSrDisplayUnits(u => ({ ...u, [index]: "kg" }))} className={cn("px-1 flex-1 border-t border-border transition-colors", displayUnit === "kg" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>kg</button>
                        </div>
                      </div>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => removeSr(index)}
                    className="flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => appendSr({ componentSubRecipeId: 0, quantity: 1 })}
            disabled={availableSubRecipes.length === 0}
            className="mt-2 w-full px-2 py-2 rounded-lg border border-dashed border-primary/40 text-primary hover:bg-primary/10 transition-colors text-xs font-medium flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <Plus className="w-3 h-3" /> Add sub-recipe component
          </button>
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
          <textarea
            {...register("notes")}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[56px] resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Sub-Recipe"}
        </button>
      </form>
    </>
  );
}

function EditSubRecipeDialog({
  id,
  open,
  onOpenChange,
  ingredients,
  subRecipes,
}: {
  id: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ingredients: IngredientOption[];
  subRecipes: SubRecipeOption[];
}) {
  const { data: detail, isLoading } = useGetSubRecipe(id, { query: { enabled: open } });
  const { updateSubRecipe } = useAppMutations();

  const [formIsDirty, setFormIsDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const submitRef = useRef<(() => void) | null>(null);

  if (!open) return null;

  function handleOpenChange(v: boolean) {
    if (!v && formIsDirty) {
      setConfirmOpen(true);
    } else {
      onOpenChange(v);
    }
  }

  function handleDiscard() {
    setConfirmOpen(false);
    setFormIsDirty(false);
    onOpenChange(false);
  }

  function handleSaveFromConfirm() {
    setConfirmOpen(false);
    submitRef.current?.();
  }

  const defaultValues: FormValues = detail
    ? {
        name: detail.name,
        description: detail.description ?? "",
        yield: Number(detail.yield),
        yieldUnit: detail.yieldUnit,
        notes: detail.notes ?? "",
        shelfLifeDays: detail.shelfLifeDays != null ? Number(detail.shelfLifeDays) : undefined,
        isBase: detail.isBase ?? false,
        expandInPrep: (detail as Record<string, unknown>).expandInPrep as boolean ?? false,
        labelDeclaration: (detail as Record<string, unknown>).labelDeclaration as string ?? "",
        ingredients: (detail.ingredients ?? []).map(i => ({
          ingredientId: i.ingredientId,
          quantity: Number(i.quantity),
          hideFromPrep: (i as Record<string, unknown>).hideFromPrep === true,
        })),
        subRecipeComponents: (detail.subRecipeComponents ?? []).map(c => ({
          componentSubRecipeId: c.componentSubRecipeId,
          quantity: Number(c.quantity),
        })),
      }
    : { name: "", description: "", yield: 1, yieldUnit: "kg", notes: "", shelfLifeDays: undefined, isBase: false, expandInPrep: false, labelDeclaration: "", ingredients: [], subRecipeComponents: [] };

  return (
    <>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="bg-card border-border rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this sub-recipe. What would you like to do?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel className="sm:mr-auto">Keep editing</AlertDialogCancel>
            <button
              onClick={handleDiscard}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium px-4 py-2 border border-destructive text-destructive hover:bg-destructive/10 transition-colors"
            >
              Discard changes
            </button>
            <AlertDialogAction
              onClick={handleSaveFromConfirm}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Save changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[720px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Edit Sub-Recipe</DialogTitle>
          </DialogHeader>
          {isLoading ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              {detail && (
                <YieldComparison detail={detail as SubRecipeDetail} />
              )}
              <SubRecipeForm
                key={id}
                defaultValues={defaultValues}
                isEdit
                isPending={updateSubRecipe.isPending}
                ingredients={ingredients}
                subRecipes={subRecipes}
                cyclicIds={detail?.cyclicIds}
                onDirtyChange={setFormIsDirty}
                submitRef={submitRef}
                onSubmit={(data) => updateSubRecipe.mutate({ id, data }, { onSuccess: () => onOpenChange(false) })}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

type BatchMultiplier = 1 | 2 | 4 | "custom";

function BatchMultiplierControl({
  multiplier,
  customBatches,
  targetYield,
  yieldPerBatch,
  yieldUnit,
  onMultiplierChange,
  onCustomBatchesChange,
  onTargetYieldChange,
}: {
  multiplier: BatchMultiplier;
  customBatches: number;
  targetYield: string;
  yieldPerBatch: number;
  yieldUnit: string;
  onMultiplierChange: (m: BatchMultiplier) => void;
  onCustomBatchesChange: (n: number) => void;
  onTargetYieldChange: (v: string) => void;
}) {
  const effectiveBatches = multiplier === "custom" ? customBatches : multiplier;
  const totalYield = yieldPerBatch * effectiveBatches;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-muted-foreground">Batches:</span>
        {([1, 2, 4] as const).map(m => (
          <button
            key={m}
            onClick={() => onMultiplierChange(m)}
            className={`px-3.5 py-1.5 rounded-xl text-sm font-semibold border transition-all ${
              multiplier === m
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border text-foreground hover:bg-secondary/60"
            }`}
          >
            {m}×
          </button>
        ))}
        <button
          onClick={() => onMultiplierChange("custom")}
          className={`px-3.5 py-1.5 rounded-xl text-sm font-semibold border transition-all ${
            multiplier === "custom"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background border-border text-foreground hover:bg-secondary/60"
          }`}
        >
          Custom
        </button>
        {multiplier === "custom" && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onCustomBatchesChange(Math.max(1, customBatches - 1))}
              className="w-7 h-7 rounded-lg border border-border flex items-center justify-center hover:bg-secondary/60 transition-colors"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <NumberInput
              min={1}
              emptyValue={1}
              value={customBatches}
              onChange={n => onCustomBatchesChange(Math.max(1, n))}
              className="w-16 text-center px-2 py-1.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={() => onCustomBatchesChange(customBatches + 1)}
              className="w-7 h-7 rounded-lg border border-border flex items-center justify-center hover:bg-secondary/60 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Target className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Or enter target yield:</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              step={0.1}
              value={targetYield}
              onChange={e => onTargetYieldChange(e.target.value)}
              placeholder={`e.g. ${(yieldPerBatch * 2).toFixed(1)}`}
              className="w-24 px-2 py-1 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <span className="text-xs text-muted-foreground">{yieldUnit}</span>
          </div>
        </div>
        <div className="ml-auto bg-primary/10 text-primary rounded-xl px-3.5 py-1.5 text-sm font-semibold">
          Total yield: {totalYield % 1 === 0 ? totalYield : totalYield.toFixed(3)} {yieldUnit}
        </div>
      </div>
    </div>
  );
}

function ScaledIngredientList({
  ingredients,
  subRecipeComponents,
  effectiveBatches,
}: {
  ingredients: SubRecipeDetail["ingredients"];
  subRecipeComponents: NonNullable<SubRecipeDetail["subRecipeComponents"]>;
  effectiveBatches: number;
}) {
  if (ingredients.length === 0 && subRecipeComponents.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No ingredients defined.</p>;
  }

  const fmtScaled = (qty: number, unit: string, batches: number): string => {
    const scaled = qty * batches;
    if (unit === "g" && scaled >= 1000) return `${(scaled / 1000).toFixed(3)} kg`;
    if (unit === "ml" && scaled >= 1000) return `${(scaled / 1000).toFixed(2)} l`;
    return `${scaled % 1 === 0 ? scaled : scaled.toFixed(3)} ${unit}`;
  };

  return (
    <div className="space-y-1.5">
      {ingredients.map(ing => (
        <div
          key={ing.id}
          className="flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-background"
        >
          <span className="font-medium text-sm">{ing.ingredientName}</span>
          <span className="text-base font-bold tabular-nums text-primary">
            {fmtScaled(ing.quantity, ing.unit, effectiveBatches)}
          </span>
        </div>
      ))}
      {subRecipeComponents.map(c => (
        <div
          key={c.id}
          className="flex items-center justify-between px-4 py-3 rounded-xl border border-dashed border-primary/40 bg-primary/5"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <Layers className="w-3.5 h-3.5 text-primary/70" />
            {c.componentSubRecipeName ?? `SR-${c.componentSubRecipeId}`}
          </span>
          <span className="text-base font-bold tabular-nums text-primary">
            {fmtScaled(c.quantity, c.componentYieldUnit ?? "kg", effectiveBatches)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ViewSubRecipeDialog({
  id,
  open,
  onOpenChange,
}: {
  id: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: detail, isLoading } = useGetSubRecipe(id, { query: { enabled: open } });
  const [multiplier, setMultiplier] = useState<BatchMultiplier>(1);
  const [customBatches, setCustomBatches] = useState(1);
  const [targetYield, setTargetYield] = useState("");

  const yieldPerBatch = detail ? Number(detail.yield) : 1;
  const yieldUnit = detail?.yieldUnit ?? "kg";

  const handleTargetYieldChange = (v: string) => {
    setTargetYield(v);
    const parsed = parseFloat(v);
    if (!isNaN(parsed) && parsed > 0 && yieldPerBatch > 0) {
      const needed = Math.ceil(parsed / yieldPerBatch);
      setMultiplier("custom");
      setCustomBatches(needed);
    }
  };

  const effectiveBatches = multiplier === "custom" ? customBatches : multiplier;

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            {detail?.name ?? "Sub-Recipe"}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : detail ? (
          <div className="space-y-5 mt-1">
            {detail.description && (
              <p className="text-sm text-muted-foreground">{detail.description}</p>
            )}

            <div className="flex items-center gap-4 flex-wrap text-sm">
              <div className="bg-secondary/30 rounded-lg px-3 py-1.5">
                <span className="text-muted-foreground">Yield per batch: </span>
                <span className="font-semibold">{yieldPerBatch} {yieldUnit}</span>
              </div>
              {detail.shelfLifeDays != null && (
                <div className="bg-secondary/30 rounded-lg px-3 py-1.5">
                  <span className="text-muted-foreground">Shelf life: </span>
                  <span className="font-semibold">{detail.shelfLifeDays} days</span>
                </div>
              )}
            </div>

            <div className="border border-border rounded-xl p-4 bg-secondary/10 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Batch Scale</p>
              <BatchMultiplierControl
                multiplier={multiplier}
                customBatches={customBatches}
                targetYield={targetYield}
                yieldPerBatch={yieldPerBatch}
                yieldUnit={yieldUnit}
                onMultiplierChange={(m) => { setMultiplier(m); setTargetYield(""); }}
                onCustomBatchesChange={(n) => { setCustomBatches(n); setTargetYield(""); }}
                onTargetYieldChange={handleTargetYieldChange}
              />
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Ingredients {effectiveBatches > 1 ? `× ${effectiveBatches} batches` : "(1 batch)"}
              </p>
              <ScaledIngredientList
                ingredients={detail.ingredients ?? []}
                subRecipeComponents={detail.subRecipeComponents ?? []}
                effectiveBatches={effectiveBatches}
              />
            </div>

            {detail.notes && (
              <div className="rounded-xl border border-border bg-secondary/10 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Notes</p>
                <p className="text-sm">{detail.notes}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">Sub-recipe not found.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function SubRecipes() {
  const { data: subRecipes, isLoading } = useListSubRecipes();
  const { data: ingredients } = useListIngredients();
  const { createSubRecipe, deleteSubRecipe } = useAppMutations();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addFormDirty, setAddFormDirty] = useState(false);
  const [addConfirmOpen, setAddConfirmOpen] = useState(false);
  const addSubmitRef = useRef<(() => void) | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);

  const filtered = subRecipes?.filter(r => r.name.toLowerCase().includes(debouncedSearch.toLowerCase()));

  const ingredientList: IngredientOption[] = (ingredients ?? []).map(i => ({
    id: i.id,
    name: i.name,
    unit: i.unit,
    processingRatio: i.processingRatio ?? null,
  }));

  const subRecipeList: SubRecipeOption[] = (subRecipes ?? []).map(sr => ({
    id: sr.id,
    name: sr.name,
    yieldUnit: sr.yieldUnit,
  }));

  const addDefaults: FormValues = {
    name: "", description: "", yield: 1, yieldUnit: "kg", notes: "", shelfLifeDays: undefined, isBase: false, expandInPrep: false, labelDeclaration: "",
    ingredients: [],
    subRecipeComponents: [],
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sub-Recipes (Prep)"
        description="Manage intermediate preparations like sauces, doughs, or spice mixes."
        action={
          <button
            onClick={() => setIsAddOpen(true)}
            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 flex items-center gap-2 hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-5 h-5" /> Create Sub-Recipe
          </button>
        }
      />

      <AlertDialog open={addConfirmOpen} onOpenChange={setAddConfirmOpen}>
        <AlertDialogContent className="bg-card border-border rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this sub-recipe. What would you like to do?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel className="sm:mr-auto">Keep editing</AlertDialogCancel>
            <button
              onClick={() => { setAddConfirmOpen(false); setAddFormDirty(false); setIsAddOpen(false); }}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium px-4 py-2 border border-destructive text-destructive hover:bg-destructive/10 transition-colors"
            >
              Discard changes
            </button>
            <AlertDialogAction
              onClick={() => { setAddConfirmOpen(false); addSubmitRef.current?.(); }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Save changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isAddOpen} onOpenChange={(v) => {
        if (!v && addFormDirty) {
          setAddConfirmOpen(true);
        } else {
          setIsAddOpen(v);
        }
      }}>
        <DialogContent className="sm:max-w-[720px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">New Sub-Recipe</DialogTitle>
          </DialogHeader>
          <SubRecipeForm
            defaultValues={addDefaults}
            isEdit={false}
            isPending={createSubRecipe.isPending}
            ingredients={ingredientList}
            subRecipes={subRecipeList}
            onDirtyChange={setAddFormDirty}
            submitRef={addSubmitRef}
            onSubmit={(data) => createSubRecipe.mutate({ data }, { onSuccess: () => setIsAddOpen(false) })}
          />
        </DialogContent>
      </Dialog>

      {editingId !== null && (
        <EditSubRecipeDialog
          id={editingId}
          open={editingId !== null}
          onOpenChange={(v) => { if (!v) setEditingId(null); }}
          ingredients={ingredientList}
          subRecipes={subRecipeList}
        />
      )}

      {viewingId !== null && (
        <ViewSubRecipeDialog
          id={viewingId}
          open={viewingId !== null}
          onOpenChange={(v) => { if (!v) setViewingId(null); }}
        />
      )}

      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sub-recipes..."
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
      )}

      {!isLoading && filtered?.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No sub-recipes yet</p>
          <p className="text-sm mt-1">Create your first sub-recipe above.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered?.map((recipe) => (
          <div key={recipe.id} className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-3 group hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
                <BookOpen className="w-5 h-5" />
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setViewingId(recipe.id)}
                  className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                  title="View & Scale"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setEditingId(recipe.id)}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
                  title="Edit"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/sub-recipes/${recipe.id}/create-kanban`, { method: "POST", credentials: "include" });
                      if (res.status === 409) { alert("A kanban already exists for this sub-recipe."); return; }
                      if (!res.ok) throw new Error("Failed");
                      alert("Kanban created with QR code!");
                    } catch { alert("Failed to create kanban."); }
                  }}
                  className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                  title="Create Kanban"
                >
                  <QrCode className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { if (confirm(`Delete "${recipe.name}"?`)) deleteSubRecipe.mutate({ id: recipe.id }); }}
                  className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-lg leading-tight">{recipe.name}</h3>
              {recipe.description && (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{recipe.description}</p>
              )}
            </div>
            <div className="mt-auto flex items-center justify-between pt-3 border-t border-border/60">
              <span className="text-sm font-medium">Yield: {recipe.yield} {recipe.yieldUnit}</span>
              <span className="text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md">
                SR-{recipe.id.toString().padStart(4, '0')}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
