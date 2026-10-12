import { useState, useEffect, useRef, useMemo } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useListSubRecipes, useListIngredients, useGetSubRecipe, useGetUpfSummary, getGetSubRecipeQueryKey, getGetUpfSummaryQueryKey } from "@workspace/api-client-react";
import { UpfChip, UpfPercentPill } from "@/components/upf-badge";
import type { Ingredient, SubRecipeDetail, SubRecipe } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { boldAllergens, declarationIssues } from "@workspace/allergens";
import { DeclarationFixButtons } from "@/components/declaration-fix";
import { rowsToDeclarationItems } from "@/lib/declaration-fix";
import { SubRecipeLabelUsage } from "@/components/sub-recipe-label-usage";
import { toGrams, kgOrNull } from "@workspace/units";
import { PageHeader } from "@/components/page-header";
import { Search, Plus, Trash2, BookOpen, X, Edit2, Loader2, AlertTriangle, CheckCircle2, RotateCcw, FlaskConical, Info, Layers, Eye, Target, Minus, QrCode, LayoutGrid, Table2, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { SubRecipePrepTimeField } from "@/components/sub-recipe-prep-time-field";
import { EditorDialog } from "@/components/recipe-editor/editor-dialog";
import { EditorForm } from "@/components/recipe-editor/editor-form";
import { LineRows } from "@/components/recipe-editor/line-rows";
import { useEditorIngredients } from "@/components/recipe-editor/use-editor-ingredients";
import { recipeSubRecipeLineCost, subRecipeIngredientLineCost } from "@/lib/recipe-line-cost";
import { buildSubRecipePayload } from "@/lib/recipe-editor-payload";
import { useFormDirty } from "@/components/recipe-editor/use-form-dirty";
import { scrollToFirstError } from "@/components/recipe-editor/scroll-to-error";

// The mix yield is derived from the components on every change, so it never
// counts as an unsaved change on its own.
const SUB_DIRTY_IGNORE = ["yield"] as const;

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  yield: z.coerce.number().min(0.01, "Must be > 0"),
  // Blank = automatic: the yield tracks 100% of the component weight on
  // every save (server-enforced). Only set for genuine process loss.
  yieldPercent: z.union([z.coerce.number().min(0.01, "1–100").max(100, "Max 100"), z.literal("")]).optional(),
  yieldUnit: z.string().min(1, "Unit required"),
  notes: z.string().optional(),
  shelfLifeDays: z.coerce.number().int().nonnegative().optional(),
  isBase: z.boolean().optional(),
  expandInPrep: z.boolean().optional(),
  madeOnProductionDay: z.boolean().optional(),
  labelDeclaration: z.string().optional(),
  ingredients: z.array(z.object({
    ingredientId: z.coerce.number().min(1, "Select an ingredient"),
    quantity: z.coerce.number().min(0.001, "Must be > 0"),
    hideFromPrep: z.boolean().optional(),
    // "" / 0 = not a marinade. Preprocessed to null so the API never sees
    // a 0 foreign key.
    marinadeForIngredientId: z.preprocess(v => (v === "" || v == null || Number(v) === 0 ? null : Number(v)), z.number().int().positive().nullable()).optional(),
    marinadeAddAtCooking: z.boolean().optional(),
  })).min(0),
  subRecipeComponents: z.array(z.object({
    componentSubRecipeId: z.coerce.number().min(1, "Select a sub-recipe"),
    quantity: z.coerce.number().min(0.001, "Must be > 0"),
    marinadeForIngredientId: z.preprocess(v => (v === "" || v == null || Number(v) === 0 ? null : Number(v)), z.number().int().positive().nullable()).optional(),
    marinadeAddAtCooking: z.boolean().optional(),
  })).min(0),
}).refine(
  (data) => data.ingredients.length > 0 || data.subRecipeComponents.length > 0,
  { message: "Add at least one ingredient or sub-recipe component", path: ["ingredients"] }
);

type FormValues = z.infer<typeof schema>;

// labelDeclaration/allergens are returned by the API but missing from the
// generated Ingredient type (same workaround as ingredients.tsx).
type IngredientOption = Pick<Ingredient, "id" | "name" | "unit" | "processingRatio" | "novaClass" | "novaMarkers"> & {
  labelDeclaration: string | null;
  allergens: string[];
  category?: string | null;
  // Same fields the recipe form's rows show — a sub-recipe is a recipe, so
  // the row should tell you as much (Graeme, 2026-08-28).
  supplierName?: string | null;
  costPerPack?: number | null;
  packWeight?: number | null;
};
type SubRecipeOption = Pick<SubRecipe, "id" | "name" | "yieldUnit"> & { costPerYieldUnit?: number | null };

// All conversions go through @workspace/units — the hand-rolled versions
// here each skipped litres, so a 10 L mayonnaise line contributed NOTHING
// to the derived batch yield (Graeme, 2026-09-04).
function toKg(value: number | string | null | undefined, unit: string): number | null {
  const n = Number(value);
  if (!isFinite(n)) return null;
  return kgOrNull(n, unit);
}

function computeProcessedKg(
  rows: { ingredientId: number; quantity: number }[],
  allIngredients: IngredientOption[],
): number {
  let total = 0;
  for (const row of rows) {
    const ing = allIngredients.find(i => i.id === Number(row.ingredientId));
    if (!ing || !row.quantity) continue;
    // Count units ("each", "box") are skipped, matching the server's
    // recalcSubRecipeYield; weights and volumes (incl. litres) all count.
    total += kgOrNull(Number(row.quantity), ing.unit) ?? 0;
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
    total += kgOrNull(Number(row.quantity), sr.yieldUnit) ?? 0;
  }
  return total;
}

// Same keyword-driven allergen bolding as the API's ingredient-deck
// endpoint, so the dialog preview matches what the recipe deck will render.

function DeclarationPreview({
  ingredientRows,
  allIngredients,
  componentRows,
  allSubRecipes,
  compoundName,
}: {
  ingredientRows: { ingredientId: number; quantity: number }[];
  allIngredients: IngredientOption[];
  componentRows: { componentSubRecipeId: number; quantity: number }[];
  allSubRecipes: SubRecipeOption[];
  compoundName?: string;
}) {
  const rows = (ingredientRows ?? [])
    .map(r => {
      const ing = allIngredients.find(i => i.id === Number(r.ingredientId));
      if (!ing || !r.quantity) return null;
      const grams = toGrams(Number(r.quantity), ing.unit);
      return { ing, grams };
    })
    .filter((x): x is { ing: IngredientOption; grams: number } => x !== null)
    .sort((a, b) => b.grams - a.grams);

  if (rows.length === 0) return null;

  const marked = rows.map(({ ing }) =>
    boldAllergens(ing.labelDeclaration || ing.name)
  );
  const componentNames = (componentRows ?? [])
    .map(r => allSubRecipes.find(s => s.id === Number(r.componentSubRecipeId))?.name)
    .filter((n): n is string => Boolean(n));
  const missing = rows.filter(({ ing }) => !ing.labelDeclaration).map(({ ing }) => ing.name);
  // Each problem ingredient as a button that opens it to fix (2026-10-12).
  const issues = declarationIssues(rowsToDeclarationItems(ingredientRows ?? [], allIngredients));

  const body = marked.join(", ");
  const text = compoundName?.trim() ? `${compoundName.trim()} (${body})` : body;
  const parts = text.split("**");

  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <p className="text-xs font-medium text-muted-foreground mb-1">
        Generated declaration — composed live from ingredient label declarations, ordered by weight, allergens bold. Recipes using this sub-recipe pick this up automatically; nothing extra to save.
      </p>
      <p className="text-sm">
        {parts.map((seg, i) => (i % 2 === 1 ? <strong key={i}>{seg}</strong> : <span key={i}>{seg}</span>))}
      </p>
      {componentNames.length > 0 && (
        <p className="text-xs text-muted-foreground mt-1">
          Components of {componentNames.join(", ")} are merged in automatically on the recipe deck (not shown here).
        </p>
      )}
      {missing.length > 0 && (
        <p className="text-xs text-amber-600 mt-1">
          Falling back to ingredient name (no label declaration set yet): {missing.join(", ")}
        </p>
      )}
      {issues.length > 0 && (
        <DeclarationFixButtons issues={issues} className="mt-2 text-xs text-amber-800 dark:text-amber-200" />
      )}
    </div>
  );
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
    const kg = kgOrNull(Number(row.quantity), ing.unit);
    if (kg === null) { allWeight = false; continue; }
    cookedKg += kg;
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
              ? "Yield looks low vs inputs — did you mean a larger yield? (e.g. a mix of " + cookedKg.toFixed(1) + " kg)"
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
    expectedKg += kgOrNull(i.quantity, i.unit) ?? 0;
  }
  for (const c of (detail.subRecipeComponents ?? [])) {
    expectedKg += kgOrNull(c.quantity, c.componentYieldUnit) ?? 0;
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
                <span className="text-xs text-muted-foreground block">Total mix cost</span>
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
  subRecipeId,
}: {
  /** Set when editing — drives the "On product labels" verdicts. */
  subRecipeId?: number;
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
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  const { register, handleSubmit, setValue, watch, formState: { errors } } = form;
  // Unsaved changes = differs from what it opened with (edit then undo =
  // clean). Drives the pinned save bar and the close guard.
  const dirty = useFormDirty(watch, defaultValues, SUB_DIRTY_IGNORE, onDirtyChange);
  // Ingredient list + "create new ingredient" from the picker (shared with
  // the recipe editor, components/recipe-editor).
  const { options: localIngredients, openQuickAdd, quickAddDialog } = useEditorIngredients<IngredientOption>(
    initialIngredients,
    created => ({ id: created.id, name: created.name, unit: created.unit, processingRatio: null, labelDeclaration: null, allergens: [] }),
    (index, id) => setValue(`ingredients.${index}.ingredientId`, id, { shouldDirty: true, shouldValidate: true }),
  );
  // Sub-recipe UPF % for the per-row pill, as in the recipe editor.
  const { data: upfSummary } = useGetUpfSummary();
  const subUpfById = useMemo(
    () => new Map((upfSummary?.subRecipes ?? []).map(s => [s.subRecipeId, s])),
    [upfSummary],
  );

  const watchedIngredients = watch("ingredients");

  // Raw meats among this sub-recipe's own ingredient rows — the valid
  // targets for a "marinade for" link (migration 0111: marinades inside
  // sub-recipes, so a cooked-down component keeps its raw-meat grouping).
  const rawMeatTargets = (watchedIngredients ?? [])
    .map(row => localIngredients.find(i => i.id === Number(row?.ingredientId)))
    .filter((i): i is IngredientOption => i != null && i.category === "raw_meat");
  const watchedSubRecipeComponents = watch("subRecipeComponents");
  const watchedLabelDeclaration = watch("labelDeclaration");
  const watchedYield = watch("yield");
  const watchedYieldUnit = watch("yieldUnit");
  const watchedYieldPercent = watch("yieldPercent");

  const save = handleSubmit(onSubmit, scrollToFirstError);
  useEffect(() => {
    if (submitRef) {
      submitRef.current = save;
    }
  }, [submitRef, save]);

  const availableSubRecipes = cyclicIds
    ? allSubRecipes.filter(sr => !cyclicIds.includes(sr.id))
    : allSubRecipes;

  // The yield is DERIVED, always: total component weight × (yield % ?? 100).
  // The server re-derives it on every save too (Graeme's rule, 2026-08-20 —
  // the Bun Dough yield went stale after milk was added and inflated every
  // scaled quantity by 1.5×). This preview just keeps the form honest.
  const totalComponentKg = computeProcessedKg(watchedIngredients ?? [], localIngredients)
    + computeComponentKg(watchedSubRecipeComponents ?? [], allSubRecipes);
  const effectivePercent = watchedYieldPercent !== "" && watchedYieldPercent != null && Number(watchedYieldPercent) > 0
    ? Math.min(100, Number(watchedYieldPercent))
    : 100;

  useEffect(() => {
    if (watchedYieldUnit !== "kg" && watchedYieldUnit !== "g") return;
    if (totalComponentKg <= 0) return;
    const derivedKg = totalComponentKg * (effectivePercent / 100);
    const autoValue = watchedYieldUnit === "g"
      ? parseFloat((derivedKg * 1000).toFixed(1))
      : parseFloat(derivedKg.toFixed(3));
    setValue("yield", autoValue, { shouldValidate: false });
  }, [totalComponentKg, effectivePercent, watchedYieldUnit, setValue]);



  return (
    <>
      {quickAddDialog}

      {/* Shared layout with the recipe editor (components/recipe-editor). */}
      <EditorForm
        onSubmit={save}
        details={<>
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
              <label className="text-sm font-medium">Mix Yield *</label>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {effectivePercent < 100 ? `Auto · ${effectivePercent}% of weight` : "Auto · 100% of weight"}
              </span>
            </div>
            <input
              type="number"
              step="0.001"
              {...register("yield")}
              readOnly
              tabIndex={-1}
              className="w-full px-3 py-2 bg-primary/5 border border-primary/40 rounded-lg text-sm focus:outline-none cursor-default"
              placeholder="Add ingredients…"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Always tracks the recipe's total weight ({totalComponentKg > 0 ? `${totalComponentKg.toFixed(3)} kg of components` : "add ingredients"}) so it can never go stale. Use Yield % for process loss.
            </p>
            {errors.yield && <span className="text-destructive text-xs">{errors.yield.message}</span>}
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Yield % <span className="font-normal text-muted-foreground">(blank = 100%)</span></label>
            <input
              type="number"
              step="0.1"
              min="1"
              max="100"
              {...register("yieldPercent")}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="100"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Only set when the process genuinely loses weight — e.g. 85 for a sauce reduced to 85% of its inputs.
            </p>
            {errors.yieldPercent && <span className="text-destructive text-xs">{errors.yieldPercent.message}</span>}
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

        <div className="flex items-center gap-3 py-1">
          <input
            type="checkbox"
            id="madeOnProductionDay"
            {...register("madeOnProductionDay")}
            className="w-4 h-4 rounded border-border accent-primary"
          />
          <div>
            <label htmlFor="madeOnProductionDay" className="text-sm font-medium cursor-pointer">Made on production day (dough only)</label>
            <p className="text-xs text-muted-foreground">For doughs mixed on the day of production (e.g. cinnamon bun dough) instead of the day before. The dough station shows it on the plan's own day, not the day-before view.</p>
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
          <DeclarationPreview
            ingredientRows={watchedIngredients ?? []}
            allIngredients={localIngredients}
            componentRows={watchedSubRecipeComponents ?? []}
            allSubRecipes={allSubRecipes}
            compoundName={watchedLabelDeclaration}
          />
          <SubRecipeLabelUsage subRecipeId={subRecipeId ?? null} />
        </div>

        </>}
        lines={[
          <LineRows
            key="ingredients"
            form={form}
            kind="ingredient"
            name="ingredients"
            idField="ingredientId"
            title="Ingredients"
            emptyText="No raw ingredients added yet."
            addLabel="Add ingredient to sub-recipe"
            options={localIngredients}
            onQuickAdd={openQuickAdd}
            newRow={() => ({ ingredientId: 0, quantity: 0, hideFromPrep: false, marinadeForIngredientId: null, marinadeAddAtCooking: false })}
            lineCost={row => subRecipeIngredientLineCost(row?.quantity, localIngredients.find(i => i.id === Number(row?.ingredientId)))}
            hideFromPrep
            ratioNote
            link={{
              word: "Marinade for",
              addLabel: "+ Marinade for a raw meat",
              // Only a non-meat line can be a marinade, and only for a raw
              // meat in this sub-recipe (migration 0111).
              targets: row => localIngredients.find(i => i.id === Number(row?.ingredientId))?.category === "raw_meat" ? [] : rawMeatTargets,
            }}
          />,
          <LineRows
            key="components"
            form={form}
            kind="subRecipe"
            name="subRecipeComponents"
            idField="componentSubRecipeId"
            tone="accent"
            title="Sub-recipe Components"
            emptyText={availableSubRecipes.length === 0 ? "No other sub-recipes available yet." : "No nested sub-recipes added yet."}
            addLabel="Add sub-recipe component"
            addDisabled={availableSubRecipes.length === 0}
            options={availableSubRecipes}
            upfById={subUpfById}
            newRow={() => ({ componentSubRecipeId: 0, quantity: 0, marinadeForIngredientId: null, marinadeAddAtCooking: false })}
            lineCost={row => recipeSubRecipeLineCost(row?.quantity, allSubRecipes.find(s => s.id === Number(row?.componentSubRecipeId)), 1)}
            link={{ word: "Marinade for", addLabel: "+ Marinade for a raw meat", targets: () => rawMeatTargets }}
          />,
        ]}
        afterLines={<>
          {errors.ingredients?.message && (
            <span className="text-destructive text-sm block">{errors.ingredients.message}</span>
          )}
          {((watchedIngredients?.length ?? 0) > 0 || (watchedSubRecipeComponents?.length ?? 0) > 0) && (
            <YieldSanityCheck
              ingredientRows={watchedIngredients ?? []}
              allIngredients={localIngredients}
              componentRows={watchedSubRecipeComponents ?? []}
              allSubRecipes={allSubRecipes}
              yieldValue={watchedYield ?? 0}
              yieldUnit={watchedYieldUnit ?? "kg"}
            />
          )}
        </>}
        notes={register("notes")}
        save={{
          mode: isEdit ? "edit" : "create",
          dirty,
          saving: isPending,
          label: isEdit ? "Save changes" : "Create sub-recipe",
          onSave: () => { void save(); },
        }}
      />
    </>
  );
}

// Returned by the API (the detail route spreads the full DB row) but not yet
// in the generated SubRecipeDetail type — the OpenAPI spec lags the server.
type SubRecipeDetailApi = SubRecipeDetail & {
  madeOnProductionDay?: boolean;
  labelDeclaration?: string | null;
  // Returned by GET /api/sub-recipes/:id (routes/sub-recipes.ts serialises
  // yield_percent as number | null); generated type lags the API.
  yieldPercent?: number | null;
};

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
  const { data: detail, isLoading } = useGetSubRecipe(id, { query: { enabled: open, queryKey: getGetSubRecipeQueryKey(id) } });
  const { updateSubRecipe } = useAppMutations();

  const [formIsDirty, setFormIsDirty] = useState(false);
  const submitRef = useRef<(() => void) | null>(null);

  if (!open) return null;

  const defaultValues: FormValues = detail
    ? {
        name: detail.name,
        description: detail.description ?? "",
        yield: Number(detail.yield),
        yieldPercent: (detail as SubRecipeDetailApi).yieldPercent ?? "",
        yieldUnit: detail.yieldUnit,
        notes: detail.notes ?? "",
        shelfLifeDays: detail.shelfLifeDays != null ? Number(detail.shelfLifeDays) : undefined,
        isBase: detail.isBase ?? false,
        expandInPrep: detail.expandInPrep ?? false,
        madeOnProductionDay: (detail as SubRecipeDetailApi).madeOnProductionDay ?? false,
        labelDeclaration: (detail as SubRecipeDetailApi).labelDeclaration ?? "",
        ingredients: (detail.ingredients ?? []).map(i => ({
          ingredientId: i.ingredientId,
          quantity: Number(i.quantity),
          hideFromPrep: i.hideFromPrep === true,
          marinadeForIngredientId: (i as { marinadeForIngredientId?: number | null }).marinadeForIngredientId ?? null,
          marinadeAddAtCooking: (i as { marinadeAddAtCooking?: boolean }).marinadeAddAtCooking === true,
        })),
        subRecipeComponents: (detail.subRecipeComponents ?? []).map(c => ({
          componentSubRecipeId: c.componentSubRecipeId,
          quantity: Number(c.quantity),
          marinadeForIngredientId: (c as { marinadeForIngredientId?: number | null }).marinadeForIngredientId ?? null,
          marinadeAddAtCooking: (c as { marinadeAddAtCooking?: boolean }).marinadeAddAtCooking === true,
        })),
      }
    : { name: "", description: "", yield: 1, yieldPercent: "", yieldUnit: "kg", notes: "", shelfLifeDays: undefined, isBase: false, expandInPrep: false, madeOnProductionDay: false, labelDeclaration: "", ingredients: [], subRecipeComponents: [] };

  return (
    <EditorDialog
      open={open}
      onClose={() => { setFormIsDirty(false); onOpenChange(false); }}
      dirty={formIsDirty}
      onSaveRequest={() => submitRef.current?.()}
      entityLabel="sub-recipe"
      title="Edit Sub-Recipe"
    >
          {isLoading ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              {detail && (
                <YieldComparison detail={detail as SubRecipeDetail} />
              )}
              {detail && (
                <SubRecipePrepTimeField subRecipeId={id} yieldText={`${Number(detail.yield)} ${detail.yieldUnit}`} />
              )}
              <SubRecipeForm
                key={id}
                subRecipeId={id}
                defaultValues={defaultValues}
                isEdit
                isPending={updateSubRecipe.isPending}
                ingredients={ingredients}
                subRecipes={subRecipes}
                cyclicIds={detail?.cyclicIds}
                onDirtyChange={setFormIsDirty}
                submitRef={submitRef}
                onSubmit={(data) => updateSubRecipe.mutate({ id, data: buildSubRecipePayload(data) }, { onSuccess: () => onOpenChange(false) })}
              />
            </>
          )}
    </EditorDialog>
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
        <span className="text-sm font-medium text-muted-foreground">Mixes:</span>
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
  const { data: allIngredients } = useListIngredients();
  const { data: upfSummary } = useGetUpfSummary();
  const novaById = useMemo(
    () => new Map((allIngredients ?? []).map(i => [i.id, { novaClass: i.novaClass ?? null, novaMarkers: i.novaMarkers ?? [] }])),
    [allIngredients],
  );
  const subUpfById = useMemo(
    () => new Map((upfSummary?.subRecipes ?? []).map(s => [s.subRecipeId, s])),
    [upfSummary],
  );
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
          <span className="font-medium text-sm inline-flex items-center gap-1.5">
            {ing.ingredientName}
            <UpfChip
              novaClass={novaById.get((ing as { ingredientId?: number }).ingredientId ?? -1)?.novaClass}
              markers={novaById.get((ing as { ingredientId?: number }).ingredientId ?? -1)?.novaMarkers}
            />
          </span>
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
            {(() => {
              const upf = subUpfById.get(c.componentSubRecipeId);
              return upf != null && (upf.upfPercent ?? 0) > 0 ? (
                <UpfPercentPill
                  percent={upf.upfPercent}
                  unclassifiedCount={upf.unclassifiedIngredients.length}
                  upfNames={upf.upfIngredients.map(u => u.name)}
                />
              ) : null;
            })()}
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
  const { data: detail, isLoading } = useGetSubRecipe(id, { query: { enabled: open, queryKey: getGetSubRecipeQueryKey(id) } });
  const { data: viewUpfSummary } = useGetUpfSummary({ query: { enabled: open, queryKey: getGetUpfSummaryQueryKey() } });
  const viewUpf = viewUpfSummary?.subRecipes.find(s => s.subRecipeId === id);
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
                <span className="text-muted-foreground">Yield per mix: </span>
                <span className="font-semibold">{yieldPerBatch} {yieldUnit}</span>
              </div>
              {detail.shelfLifeDays != null && (
                <div className="bg-secondary/30 rounded-lg px-3 py-1.5">
                  <span className="text-muted-foreground">Shelf life: </span>
                  <span className="font-semibold">{detail.shelfLifeDays} days</span>
                </div>
              )}
              {viewUpf && (
                <UpfPercentPill
                  percent={viewUpf.upfPercent}
                  unclassifiedCount={viewUpf.unclassifiedIngredients.length}
                  upfNames={viewUpf.upfIngredients.map(u => u.name)}
                />
              )}
            </div>

            <div className="border border-border rounded-xl p-4 bg-secondary/10 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mix Scale</p>
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
                Ingredients {effectiveBatches > 1 ? `× ${effectiveBatches} mixes` : "(1 mix)"}
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
  const { data: upfSummary } = useGetUpfSummary();
  const subUpfById = useMemo(
    () => new Map((upfSummary?.subRecipes ?? []).map(s => [s.subRecipeId, s])),
    [upfSummary],
  );
  const { createSubRecipe, deleteSubRecipe } = useAppMutations();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addFormDirty, setAddFormDirty] = useState(false);
  const addSubmitRef = useRef<(() => void) | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);
  // Same list controls as the recipes page — a sub-recipe is a recipe, so
  // browsing them should feel identical (Graeme, 2026-08-28).
  const [viewMode, setViewMode] = useState<"cards" | "table">("table");
  type SubSortKey = "name" | "yield" | "upf";
  const [sortKey, setSortKey] = useState<SubSortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const searched = subRecipes?.filter(r => r.name.toLowerCase().includes(debouncedSearch.toLowerCase()));
  const filtered = [...(searched ?? [])].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "yield") return (Number(a.yield) - Number(b.yield)) * dir;
    if (sortKey === "upf") {
      const av = subUpfById.get(a.id)?.upfPercent ?? -1;
      const bv = subUpfById.get(b.id)?.upfPercent ?? -1;
      return (Number(av) - Number(bv)) * dir;
    }
    return a.name.localeCompare(b.name) * dir;
  });
  const toggleSort = (key: SubSortKey) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };
  const SortHead = ({ label, k, align = "left" }: { label: string; k: SubSortKey; align?: "left" | "right" }) => (
    <th className={cn("px-3 py-2 font-medium", align === "right" ? "text-right" : "text-left")}>
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
        {label}
        {sortKey === k
          ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
          : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </th>
  );

  const ingredientList: IngredientOption[] = (ingredients ?? []).map(i => ({
    id: i.id,
    name: i.name,
    unit: i.unit,
    processingRatio: i.processingRatio ?? null,
    novaClass: i.novaClass ?? null,
    novaMarkers: i.novaMarkers ?? [],
    labelDeclaration: (i as { labelDeclaration?: string | null }).labelDeclaration ?? null,
    allergens: (i as { allergens?: string[] }).allergens ?? [],
    supplierName: (i as unknown as { supplierName?: string | null }).supplierName ?? null,
    costPerPack: Number((i as unknown as { costPerPack?: number | string }).costPerPack ?? 0) || 0,
    packWeight: Number((i as unknown as { packWeight?: number | string }).packWeight ?? 0) || 0,
    // Drives the "Marinade for" targets: only raw_meat rows qualify.
    category: (i as unknown as { category?: string | null }).category ?? null,
  }));

  const subRecipeList: SubRecipeOption[] = (subRecipes ?? []).map(sr => ({
    id: sr.id,
    name: sr.name,
    yieldUnit: sr.yieldUnit,
    // Line cost of a nested component (qty × cost per yield unit), as the
    // recipe editor shows for its sub-recipe lines.
    costPerYieldUnit: Number(sr.costPerYieldUnit) || 0,
  }));

  const addDefaults: FormValues = {
    name: "", description: "", yield: 1, yieldUnit: "kg", notes: "", shelfLifeDays: undefined, isBase: false, expandInPrep: false, madeOnProductionDay: false, labelDeclaration: "",
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

      <EditorDialog
        open={isAddOpen}
        onClose={() => { setAddFormDirty(false); setIsAddOpen(false); }}
        dirty={addFormDirty}
        onSaveRequest={() => addSubmitRef.current?.()}
        entityLabel="sub-recipe"
          title="New Sub-Recipe"
      >
          <SubRecipeForm
            defaultValues={addDefaults}
            isEdit={false}
            isPending={createSubRecipe.isPending}
            ingredients={ingredientList}
            subRecipes={subRecipeList}
            onDirtyChange={setAddFormDirty}
            submitRef={addSubmitRef}
            onSubmit={(data) => createSubRecipe.mutate({ data: buildSubRecipePayload(data) }, { onSuccess: () => { setAddFormDirty(false); setIsAddOpen(false); } })}
          />
      </EditorDialog>

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

      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="relative max-w-md flex-1 min-w-[16rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sub-recipes..."
            className="w-full pl-9 pr-8 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode("cards")}
            className={cn("px-2.5 py-1.5 flex items-center", viewMode === "cards" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground")}
            title="Card view"
            aria-pressed={viewMode === "cards"}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("table")}
            className={cn("px-2.5 py-1.5 flex items-center border-l border-border", viewMode === "table" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground")}
            title="Table view"
            aria-pressed={viewMode === "table"}
          >
            <Table2 className="w-4 h-4" />
          </button>
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

      {viewMode === "table" && !isLoading && (filtered?.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-border overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-muted-foreground">
              <tr>
                <SortHead label="Name" k="name" />
                <th className="px-3 py-2 font-medium text-left">Code</th>
                <SortHead label="Yield" k="yield" align="right" />
                <SortHead label="UPF" k="upf" align="right" />
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered?.map(recipe => {
                const upf = subUpfById.get(recipe.id);
                return (
                  <tr key={recipe.id} className="border-t border-border/60 hover:bg-secondary/20">
                    <td className="px-3 py-2">
                      <button onClick={() => setViewingId(recipe.id)} className="font-medium hover:text-primary transition-colors text-left">
                        {recipe.name}
                      </button>
                      {recipe.description && (
                        <span className="block text-xs text-muted-foreground truncate max-w-md">{recipe.description}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">SR-{recipe.id.toString().padStart(4, "0")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{recipe.yield} {recipe.yieldUnit}</td>
                    <td className="px-3 py-2 text-right">
                      {upf ? (
                        <UpfPercentPill
                          percent={upf.upfPercent}
                          unclassifiedCount={upf.unclassifiedIngredients.length}
                          upfNames={upf.upfIngredients.map(u => u.name)}
                        />
                      ) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setViewingId(recipe.id)} className="p-1.5 text-muted-foreground hover:text-primary rounded-lg transition-colors" title="View & Scale"><Eye className="w-4 h-4" /></button>
                        <button onClick={() => setEditingId(recipe.id)} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors" title="Edit"><Edit2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5", viewMode === "table" && "hidden")}>
        {filtered?.map((recipe) => (
          <div key={recipe.id} className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-3 group hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
                <BookOpen className="w-5 h-5" />
              </div>
              <div className="flex items-center gap-1">
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
            <div className="mt-auto flex items-center justify-between gap-2 pt-3 border-t border-border/60">
              <span className="text-sm font-medium">Yield: {recipe.yield} {recipe.yieldUnit}</span>
              <span className="flex items-center gap-1.5">
                {(() => {
                  const upf = subUpfById.get(recipe.id);
                  return upf ? (
                    <UpfPercentPill
                      percent={upf.upfPercent}
                      unclassifiedCount={upf.unclassifiedIngredients.length}
                      upfNames={upf.upfIngredients.map(u => u.name)}
                    />
                  ) : null;
                })()}
                <span className="text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md">
                  SR-{recipe.id.toString().padStart(4, '0')}
                </span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
