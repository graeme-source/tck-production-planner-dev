import { useState, useEffect, useRef } from "react";
import { useListSubRecipes, useListIngredients, useGetSubRecipe } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { QuickAddIngredientDialog } from "@/components/quick-add-ingredient";
import { Search, Plus, Trash2, BookOpen, X, Edit2, Loader2, AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
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

function YieldSanityCheck({
  ingredientRows,
  allIngredients,
  yieldValue,
  yieldUnit,
}: {
  ingredientRows: { ingredientId: number; quantity: number }[];
  allIngredients: { id: number; name: string; unit: string }[];
  yieldValue: number;
  yieldUnit: string;
}) {
  // Sum kg-equivalent inputs (g → kg, kg stays kg; skip non-weight units)
  let totalKg = 0;
  let allWeight = true;
  for (const row of ingredientRows) {
    const ing = allIngredients.find(i => i.id === row.ingredientId);
    if (!ing) continue;
    if (ing.unit === "kg") totalKg += row.quantity;
    else if (ing.unit === "g") totalKg += row.quantity / 1000;
    else allWeight = false;
  }

  if (totalKg === 0) return null;
  const yieldKg = yieldUnit === "kg" ? yieldValue : yieldUnit === "g" ? yieldValue / 1000 : null;
  if (yieldKg === null) return null;

  const ratio = yieldKg / totalKg;
  const pct = (ratio * 100).toFixed(0);
  const ok = ratio >= 0.5 && ratio <= 1.05; // 50–105% is physically plausible
  const warning = !ok;

  return (
    <div className={`rounded-lg px-3.5 py-2.5 text-sm flex items-start gap-2.5 ${warning ? "bg-amber-50 border border-amber-200 text-amber-800" : "bg-green-50 border border-green-200 text-green-800"}`}>
      {warning
        ? <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        : <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
      }
      <div>
        <span className="font-medium">
          {allWeight ? "" : "Weight-only ingredients: "}
          Input {totalKg.toFixed(3)} kg → Yield {yieldKg.toFixed(3)} kg ({pct}% retention)
        </span>
        {warning && (
          <p className="text-xs mt-0.5">
            {ratio < 0.5
              ? "Yield looks low vs inputs — did you mean a larger yield? (e.g. a batch of " + totalKg.toFixed(1) + " kg)"
              : "Yield exceeds total input weight — please check ingredient quantities or yield value."}
          </p>
        )}
      </div>
    </div>
  );
}

function computeTotalKg(
  rows: { ingredientId: number; quantity: number }[],
  allIngredients: { id: number; name: string; unit: string }[],
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
  ingredients: { id: number; name: string; unit: string }[];
}) {
  const { register, control, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  const { fields, append, remove } = useFieldArray({ control, name: "ingredients" });

  const [localIngredients, setLocalIngredients] = useState(initialIngredients);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTargetIndex, setQuickAddTargetIndex] = useState<number | null>(null);
  // Auto-yield: true = follow ingredient total, false = user has overridden
  const [isYieldAuto, setIsYieldAuto] = useState(!isEdit);
  const yieldInputRef = useRef<HTMLInputElement | null>(null);

  const watchedIngredients = watch("ingredients");
  const watchedYield = watch("yield");
  const watchedYieldUnit = watch("yieldUnit");

  // When in auto mode, keep yield in sync with the sum of all ingredient weights
  useEffect(() => {
    if (!isYieldAuto) return;
    if (watchedYieldUnit !== "kg" && watchedYieldUnit !== "g") return;
    const totalKg = computeTotalKg(watchedIngredients ?? [], localIngredients);
    if (totalKg <= 0) return;
    const autoValue = watchedYieldUnit === "g"
      ? parseFloat((totalKg * 1000).toFixed(1))
      : parseFloat(totalKg.toFixed(3));
    setValue("yield", autoValue, { shouldValidate: false });
  }, [watchedIngredients, isYieldAuto, watchedYieldUnit, localIngredients, setValue]);

  const resetToAuto = () => {
    setIsYieldAuto(true);
    // immediately recalculate
    const totalKg = computeTotalKg(watchedIngredients ?? [], localIngredients);
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
    setLocalIngredients(prev => [...prev, ingredient]);
    if (quickAddTargetIndex !== null) {
      setValue(`ingredients.${quickAddTargetIndex}.ingredientId`, ingredient.id);
    }
    setQuickAddTargetIndex(null);
  };

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
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  Auto
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
              {isYieldAuto ? "Tracking total ingredient weight — edit to override" : "Manual override — type a lower value for processing reduction"}
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

          {/* Column headers */}
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
              return (
                <div key={field.id} className="grid grid-cols-[1fr_80px_44px_44px] gap-2 items-center">
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
              );
            })}
          </div>

          {/* Yield sanity check */}
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
  ingredients: { id: number; name: string; unit: string }[];
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
        ingredients: (detail.ingredients ?? []).map((i: { ingredientId: number; quantity: number }) => ({
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
          <SubRecipeForm
            key={id}
            defaultValues={defaultValues}
            isEdit
            isPending={updateSubRecipe.isPending}
            ingredients={ingredients}
            onSubmit={(data) => updateSubRecipe.mutate({ id, data }, { onSuccess: () => onOpenChange(false) })}
          />
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
  const ingredientList = ingredients ?? [];

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
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
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
