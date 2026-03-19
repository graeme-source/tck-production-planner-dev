import { useState, useEffect, useRef } from "react";
import { useListSubRecipes, useListIngredients, useGetSubRecipe } from "@workspace/api-client-react";
import type { Ingredient, SubRecipeDetail } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { QuickAddIngredientDialog } from "@/components/quick-add-ingredient";
import { Search, Plus, Trash2, BookOpen, X, Edit2, Loader2, AlertTriangle, CheckCircle2, RotateCcw, FlaskConical, Info } from "lucide-react";
import { useForm, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  yield: z.coerce.number().min(0.01, "Must be > 0"),
  yieldUnit: z.string().min(1, "Unit required"),
  notes: z.string().optional(),
  ingredients: z.array(z.object({
    ingredientId: z.coerce.number().min(1, "Select an ingredient"),
    quantity: z.coerce.number().min(0.001, "Must be > 0"),
  })).min(1, "Add at least one ingredient"),
});

type FormValues = z.infer<typeof schema>;

type IngredientOption = Pick<Ingredient, "id" | "name" | "unit" | "processingRatio">;

function toKg(value: number, unit: string): number | null {
  if (unit === "kg") return value;
  if (unit === "g") return value / 1000;
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
    const ratio = ing.processingRatio ?? 1.0;
    if (ing.unit === "kg") total += Number(row.quantity) * ratio;
    else if (ing.unit === "g") total += (Number(row.quantity) / 1000) * ratio;
  }
  return total;
}

function YieldSanityCheck({
  ingredientRows,
  allIngredients,
  yieldValue,
  yieldUnit,
}: {
  ingredientRows: { ingredientId: number; quantity: number }[];
  allIngredients: IngredientOption[];
  yieldValue: number;
  yieldUnit: string;
}) {
  let rawKg = 0;
  let processedKg = 0;
  let allWeight = true;
  let anyRatio = false;

  for (const row of ingredientRows) {
    const ing = allIngredients.find(i => i.id === row.ingredientId);
    if (!ing) continue;
    let qKg: number | null = null;
    if (ing.unit === "kg") qKg = row.quantity;
    else if (ing.unit === "g") qKg = row.quantity / 1000;
    else { allWeight = false; continue; }
    const ratio = ing.processingRatio ?? 1.0;
    if (ratio < 1.0) anyRatio = true;
    rawKg += qKg;
    processedKg += qKg * ratio;
  }

  if (rawKg === 0) return null;
  const yieldKg = toKg(yieldValue, yieldUnit);
  if (yieldKg === null) return null;

  const compareKg = anyRatio ? processedKg : rawKg;
  const ratio = yieldKg / compareKg;
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
          {anyRatio
            ? `Raw input ${rawKg.toFixed(3)} kg → Processing-adjusted ${processedKg.toFixed(3)} kg → Yield ${yieldKg.toFixed(3)} kg (${pct}% of processed)`
            : `${allWeight ? "" : "Weight-only ingredients: "}Input ${rawKg.toFixed(3)} kg → Yield ${yieldKg.toFixed(3)} kg (${pct}% retention)`
          }
        </span>
        {warning && (
          <p className="text-xs mt-0.5">
            {ratio < 0.5
              ? "Yield looks low vs inputs — did you mean a larger yield? (e.g. a batch of " + compareKg.toFixed(1) + " kg)"
              : "Yield exceeds expected processed weight — please check ingredient quantities or yield value."}
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
    const ratio = i.processingRatio ?? 1.0;
    if (i.unit === "kg") expectedKg += i.quantity * ratio;
    else if (i.unit === "g") expectedKg += (i.quantity / 1000) * ratio;
  }

  const diffPct = (canCompare && expectedKg > 0)
    ? Math.abs(storedYieldKg! - expectedKg) / expectedKg * 100
    : 0;
  const hasMismatch = canCompare && expectedKg > 0 && diffPct > 2;

  const totalCost = detail.totalBatchCost ?? 0;
  const costPerUnit = detail.costPerYieldUnit ?? null;
  const hasCost = totalCost > 0;

  return (
    <div className="space-y-2 mb-4">
      {hasCost && (
        <div className="rounded-lg px-3.5 py-2.5 text-sm border bg-primary/5 border-primary/20">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium">Cost summary</span>
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
                  <FlaskConical className="w-3 h-3 inline" /> Processing-adjusted expected
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
}: {
  defaultValues: FormValues;
  onSubmit: (data: FormValues) => void;
  isPending: boolean;
  isEdit: boolean;
  ingredients: IngredientOption[];
}) {
  const { register, control, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  const { fields, append, remove } = useFieldArray({ control, name: "ingredients" });

  const [localIngredients, setLocalIngredients] = useState<IngredientOption[]>(initialIngredients);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTargetIndex, setQuickAddTargetIndex] = useState<number | null>(null);
  const [isYieldAuto, setIsYieldAuto] = useState(!isEdit);
  const yieldInputRef = useRef<HTMLInputElement | null>(null);

  const watchedIngredients = watch("ingredients");
  const watchedYield = watch("yield");
  const watchedYieldUnit = watch("yieldUnit");

  useEffect(() => {
    if (!isYieldAuto) return;
    if (watchedYieldUnit !== "kg" && watchedYieldUnit !== "g") return;
    const processedKg = computeProcessedKg(watchedIngredients ?? [], localIngredients);
    if (processedKg <= 0) return;
    const autoValue = watchedYieldUnit === "g"
      ? parseFloat((processedKg * 1000).toFixed(1))
      : parseFloat(processedKg.toFixed(3));
    setValue("yield", autoValue, { shouldValidate: false });
  }, [watchedIngredients, isYieldAuto, watchedYieldUnit, localIngredients, setValue]);

  const resetToAuto = () => {
    setIsYieldAuto(true);
    const processedKg = computeProcessedKg(watchedIngredients ?? [], localIngredients);
    if (processedKg > 0) {
      const autoValue = watchedYieldUnit === "g"
        ? parseFloat((processedKg * 1000).toFixed(1))
        : parseFloat(processedKg.toFixed(3));
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
        </div>

        <div className="border-t border-border pt-4">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-bold">Ingredients</label>
            <button
              type="button"
              onClick={() => append({ ingredientId: 0, quantity: 1 })}
              className="text-xs font-medium text-primary flex items-center gap-1 hover:underline"
            >
              <Plus className="w-3 h-3" /> Add Row
            </button>
          </div>
          {errors.ingredients?.message && (
            <span className="text-destructive text-xs block mb-2">{errors.ingredients.message}</span>
          )}

          {fields.length === 0 && (
            <p className="text-xs text-muted-foreground italic py-2">No ingredients yet — click "Add Row" to start.</p>
          )}

          {fields.length > 0 && (
            <div className="grid grid-cols-[1fr_80px_44px_44px] gap-2 mb-1 px-1">
              <span className="text-xs text-muted-foreground font-medium">Ingredient</span>
              <span className="text-xs text-muted-foreground font-medium text-center">Quantity</span>
              <span />
              <span />
            </div>
          )}

          <div className="space-y-2">
            {fields.map((field, index) => {
              const selectedId = Number(watchedIngredients?.[index]?.ingredientId ?? 0);
              const selectedIng = localIngredients.find(i => i.id === selectedId);
              const unit = selectedIng?.unit ?? "";
              const ratio = selectedIng?.processingRatio;
              return (
                <div key={field.id}>
                  <div className="grid grid-cols-[1fr_80px_44px_44px] gap-2 items-center">
                    <select
                      {...register(`ingredients.${index}.ingredientId`)}
                      className="px-2 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 truncate"
                    >
                      <option value={0} disabled>Select ingredient...</option>
                      {localIngredients.map(i => (
                        <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                      ))}
                    </select>
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
                    <button
                      type="button"
                      title="Add new ingredient"
                      onClick={() => openQuickAdd(index)}
                      className="px-1.5 py-2 rounded-lg border border-dashed border-primary/40 text-primary hover:bg-primary/10 transition-colors text-xs font-semibold"
                    >
                      +New
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(index)}
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
                </div>
              );
            })}
          </div>

          {fields.length > 0 && (
            <div className="mt-3">
              <YieldSanityCheck
                ingredientRows={watchedIngredients ?? []}
                allIngredients={localIngredients}
                yieldValue={watchedYield ?? 0}
                yieldUnit={watchedYieldUnit ?? "kg"}
              />
            </div>
          )}
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
}: {
  id: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ingredients: IngredientOption[];
}) {
  const { data: detail, isLoading } = useGetSubRecipe(id, { query: { enabled: open } });
  const { updateSubRecipe } = useAppMutations();

  if (!open) return null;

  const defaultValues: FormValues = detail
    ? {
        name: detail.name,
        description: detail.description ?? "",
        yield: Number(detail.yield),
        yieldUnit: detail.yieldUnit,
        notes: detail.notes ?? "",
        ingredients: (detail.ingredients ?? []).map(i => ({
          ingredientId: i.ingredientId,
          quantity: Number(i.quantity),
        })),
      }
    : { name: "", description: "", yield: 1, yieldUnit: "kg", notes: "", ingredients: [] };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
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
              onSubmit={(data) => updateSubRecipe.mutate({ id, data }, { onSuccess: () => onOpenChange(false) })}
            />
          </>
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
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const filtered = subRecipes?.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));

  const ingredientList: IngredientOption[] = (ingredients ?? []).map(i => ({
    id: i.id,
    name: i.name,
    unit: i.unit,
    processingRatio: i.processingRatio ?? null,
  }));

  const addDefaults: FormValues = {
    name: "", description: "", yield: 1, yieldUnit: "kg", notes: "",
    ingredients: [{ ingredientId: 0, quantity: 1 }],
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

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[600px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">New Sub-Recipe</DialogTitle>
          </DialogHeader>
          <SubRecipeForm
            defaultValues={addDefaults}
            isEdit={false}
            isPending={createSubRecipe.isPending}
            ingredients={ingredientList}
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
                  onClick={() => setEditingId(recipe.id)}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
                  title="Edit"
                >
                  <Edit2 className="w-4 h-4" />
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
