import { useState } from "react";
import { useListRecipes, useListIngredients, useListSubRecipes, useGetRecipe, useListCategoryDefaults } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { QuickAddIngredientDialog } from "@/components/quick-add-ingredient";
import { Plus, Trash2, ChefHat, X, Edit2, Loader2, TrendingUp, Package, Wrench, ChevronDown, ChevronRight, BarChart2 } from "lucide-react";
import { useForm, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().optional(),
  description: z.string().optional(),
  servings: z.coerce.number().min(0.01, "Must be > 0"),
  servingUnit: z.string().min(1, "Unit is required"),
  notes: z.string().optional(),
  packSize: z.coerce.number().min(1, "Must be ≥ 1"),
  rrp: z.coerce.number().min(0),
  packagingCost: z.coerce.number().min(0),
  labourCost: z.coerce.number().min(0),
  portionsPerBatch: z.coerce.number().int().min(1, "Must be ≥ 1"),
  ingredients: z.array(z.object({
    ingredientId: z.coerce.number().min(1, "Select ingredient"),
    quantity: z.coerce.number().min(0.001, "Must be > 0"),
  })),
  subRecipes: z.array(z.object({
    subRecipeId: z.coerce.number().min(1, "Select sub-recipe"),
    quantity: z.coerce.number().min(0.001, "Must be > 0"),
  })),
});

type FormValues = z.infer<typeof schema>;

function fmt(n: number | undefined | null) { return (Number(n) || 0).toFixed(2); }

function MarginBadge({ margin }: { margin: number | null | undefined }) {
  if (margin == null) return <span className="text-xs text-muted-foreground italic">No RRP set</span>;
  const label = `${margin.toFixed(1)}%`;
  if (margin >= 60) return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">
      <TrendingUp className="w-3 h-3" /> {label}
    </span>
  );
  if (margin >= 50) return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
      <TrendingUp className="w-3 h-3" /> {label}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">
      <TrendingUp className="w-3 h-3" /> {label}
    </span>
  );
}

function MarginBar({ margin }: { margin: number | null | undefined }) {
  if (margin == null) return null;
  const pct = Math.max(0, Math.min(100, margin));
  const color = margin >= 60 ? "bg-green-500" : margin >= 50 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="w-full bg-secondary/40 rounded-full h-1.5 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

type IngredientOption = {
  id: number;
  name: string;
  unit: string;
  processingRatio: number;
  packWeight: number;
  costPerPack: number;
};

type SubRecipeOption = {
  id: number;
  name: string;
  yieldUnit: string;
  costPerYieldUnit: number;
};

function RecipeForm({
  defaultValues,
  onSubmit,
  isPending,
  isEdit,
  ingredients: initialIngredients,
  subRecipes,
  categoryDefaults,
}: {
  defaultValues: FormValues;
  onSubmit: (data: FormValues) => void;
  isPending: boolean;
  isEdit: boolean;
  ingredients: IngredientOption[];
  subRecipes: SubRecipeOption[];
  categoryDefaults: { category: string; defaultPackagingCost: number; defaultLabourCost: number }[];
}) {
  const { register, control, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  const { fields: ingFields, append: appendIng, remove: removeIng } = useFieldArray({ control, name: "ingredients" });
  const { fields: subFields, append: appendSub, remove: removeSub } = useFieldArray({ control, name: "subRecipes" });

  const [localIngredients, setLocalIngredients] = useState(initialIngredients);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTargetIndex, setQuickAddTargetIndex] = useState<number | null>(null);

  const watchedCategory = watch("category");
  const watchedRrp = watch("rrp");
  const watchedPackaging = watch("packagingCost");
  const watchedLabour = watch("labourCost");
  const watchedServings = watch("servings");
  const watchedIngredients = watch("ingredients");
  const watchedSubRecipes = watch("subRecipes");

  const handleCategoryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cat = e.target.value;
    setValue("category", cat);
    const def = categoryDefaults.find(d => d.category.toLowerCase() === cat.toLowerCase());
    if (def) {
      setValue("packagingCost", def.defaultPackagingCost);
      setValue("labourCost", def.defaultLabourCost);
    }
  };

  const openQuickAdd = (index: number) => {
    setQuickAddTargetIndex(index);
    setQuickAddOpen(true);
  };

  const handleIngredientCreated = (ingredient: { id: number; name: string; unit: string }) => {
    const full: IngredientOption = { ...ingredient, processingRatio: 1, packWeight: 0, costPerPack: 0 };
    setLocalIngredients(prev => [...prev, full]);
    if (quickAddTargetIndex !== null) {
      setValue(`ingredients.${quickAddTargetIndex}.ingredientId`, ingredient.id);
    }
    setQuickAddTargetIndex(null);
  };

  const servings = Number(watchedServings) || 1;
  const overhead = (Number(watchedPackaging) || 0) + (Number(watchedLabour) || 0);
  const rrp = Number(watchedRrp) || 0;

  function ingLineCost(index: number): number | null {
    const row = watchedIngredients?.[index];
    if (!row) return null;
    const qty = Number(row.quantity);
    const ing = localIngredients.find(i => i.id === Number(row.ingredientId));
    if (!ing || !qty || ing.packWeight === 0) return null;
    const pr = ing.processingRatio || 1;
    const rawQty = qty / pr;
    return (rawQty * ing.costPerPack / ing.packWeight) / servings;
  }

  function subLineCost(index: number): number | null {
    const row = watchedSubRecipes?.[index];
    if (!row) return null;
    const qty = Number(row.quantity);
    const sr = subRecipes.find(s => s.id === Number(row.subRecipeId));
    if (!sr || !qty) return null;
    return (qty * sr.costPerYieldUnit) / servings;
  }

  return (
    <>
      <QuickAddIngredientDialog open={quickAddOpen} onOpenChange={setQuickAddOpen} onCreated={handleIngredientCreated} />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 mt-4">
        {/* Basic fields */}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="text-sm font-medium mb-1 block">Product Name *</label>
            <input {...register("name")} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="e.g. Classic Sourdough Loaf" />
            {errors.name && <span className="text-destructive text-xs">{errors.name.message}</span>}
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Category</label>
            <input
              {...register("category")}
              onChange={handleCategoryChange}
              value={watchedCategory ?? ""}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Bread, Sauce, Pastry…"
              list="category-list"
            />
            <datalist id="category-list">
              {categoryDefaults.map(d => <option key={d.category} value={d.category} />)}
            </datalist>
            {categoryDefaults.length > 0 && watchedCategory && categoryDefaults.find(d => d.category.toLowerCase() === watchedCategory.toLowerCase()) && (
              <p className="text-xs text-primary mt-0.5">Default costs applied from category preset.</p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Output / Recipe Size *</label>
            <div className="flex gap-2">
              <input type="number" step="0.001" {...register("servings")} className="w-24 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <input {...register("servingUnit")} className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="loaf, pack, slice…" />
            </div>
            {errors.servings && <span className="text-destructive text-xs">{errors.servings.message}</span>}
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Portions per batch *</label>
            <input type="number" step="1" min="1" {...register("portionsPerBatch")} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            {errors.portionsPerBatch && <span className="text-destructive text-xs">{errors.portionsPerBatch.message}</span>}
          </div>
          <div className="col-span-2">
            <label className="text-sm font-medium mb-1 block">Description (optional)</label>
            <textarea {...register("description")} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[48px] resize-none" placeholder="Brief description…" />
          </div>
        </div>

        {/* Pack & Pricing */}
        <div className="bg-secondary/20 rounded-xl p-4 space-y-3 border border-border/60">
          <h4 className="text-sm font-semibold flex items-center gap-2"><Package className="w-4 h-4 text-primary" /> Pack & Pricing</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Pack Size (portions)</label>
              <div className="relative">
                <input type="number" step="1" min="1" {...register("packSize")} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              {errors.packSize && <span className="text-destructive text-xs">{errors.packSize.message}</span>}
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">RRP (£)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <input type="number" step="0.01" min="0" {...register("rrp")} className="w-full pl-7 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Packaging Cost (£/pack)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <input type="number" step="0.01" min="0" {...register("packagingCost")} className="w-full pl-7 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Labour Cost (£/pack)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <input type="number" step="0.01" min="0" {...register("labourCost")} className="w-full pl-7 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="0.00" />
              </div>
            </div>
          </div>
          {rrp > 0 && (
            <p className="text-xs text-muted-foreground">
              Pack overhead (packaging + labour): <strong className="text-foreground">£{fmt(overhead)}</strong>.
              Ingredient costs are calculated automatically from the recipe ingredients below.
            </p>
          )}
        </div>

        {/* Unified Ingredients & Prep Items */}
        <div className="border-t border-border pt-4 space-y-0">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_6rem_4.5rem_1.25rem] gap-2 px-1 mb-1.5">
            <span className="text-xs text-muted-foreground font-medium">Name</span>
            <span className="text-xs text-muted-foreground font-medium">Qty</span>
            <span className="text-xs text-muted-foreground font-medium text-right">£/portion</span>
            <span />
          </div>

          {/* Ingredients section */}
          <div className="mb-1">
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs font-semibold text-primary uppercase tracking-wide">
                Ingredients <span className="font-normal normal-case text-muted-foreground tracking-normal">(cooked qty)</span>
              </span>
              <button type="button" onClick={() => appendIng({ ingredientId: 0, quantity: 0 })} className="text-xs font-medium bg-secondary px-2 py-1 rounded-md hover:bg-secondary/80 transition-colors">+ Add</button>
            </div>
            {ingFields.length === 0 && <p className="text-xs text-muted-foreground italic pl-1 pb-1">No ingredients added</p>}
            <div className="space-y-1.5">
              {ingFields.map((field, index) => {
                const cost = ingLineCost(index);
                return (
                  <div key={field.id} className="grid grid-cols-[1fr_6rem_4.5rem_1.25rem] gap-2 items-center">
                    <div className="flex gap-1 min-w-0">
                      <select {...register(`ingredients.${index}.ingredientId`)} className="flex-1 min-w-0 px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30">
                        <option value={0} disabled>Select…</option>
                        {localIngredients.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                      </select>
                      <button type="button" title="Create a new ingredient" onClick={() => openQuickAdd(index)} className="flex-shrink-0 px-1.5 py-1.5 rounded-lg border border-dashed border-primary/40 text-primary hover:bg-primary/10 transition-colors text-xs font-bold leading-none">+</button>
                    </div>
                    <input type="number" step="0.0001" {...register(`ingredients.${index}.quantity`)} className="w-full px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="0.000" />
                    <span className="text-xs tabular-nums text-right text-muted-foreground">
                      {cost !== null ? `£${cost.toFixed(4)}` : "—"}
                    </span>
                    <button type="button" onClick={() => removeIng(index)} className="text-muted-foreground hover:text-destructive flex justify-center"><X className="w-3.5 h-3.5" /></button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-dashed border-border/60 my-2" />

          {/* Sub-recipes section */}
          <div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs font-semibold text-accent uppercase tracking-wide">Prep Items</span>
              <button type="button" onClick={() => appendSub({ subRecipeId: 0, quantity: 0 })} className="text-xs font-medium bg-secondary px-2 py-1 rounded-md hover:bg-secondary/80 transition-colors">+ Add</button>
            </div>
            {subFields.length === 0 && <p className="text-xs text-muted-foreground italic pl-1 pb-1">No prep items added</p>}
            <div className="space-y-1.5">
              {subFields.map((field, index) => {
                const cost = subLineCost(index);
                return (
                  <div key={field.id} className="grid grid-cols-[1fr_6rem_4.5rem_1.25rem] gap-2 items-center">
                    <select {...register(`subRecipes.${index}.subRecipeId`)} className="min-w-0 px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30">
                      <option value={0} disabled>Select…</option>
                      {subRecipes.map(s => <option key={s.id} value={s.id}>{s.name} ({s.yieldUnit})</option>)}
                    </select>
                    <input type="number" step="0.0001" {...register(`subRecipes.${index}.quantity`)} className="w-full px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="0.000" />
                    <span className="text-xs tabular-nums text-right text-muted-foreground">
                      {cost !== null ? `£${cost.toFixed(4)}` : "—"}
                    </span>
                    <button type="button" onClick={() => removeSub(index)} className="text-muted-foreground hover:text-destructive flex justify-center"><X className="w-3.5 h-3.5" /></button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
          <textarea {...register("notes")} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px] resize-none" placeholder="Allergens, packaging notes, shelf life…" />
        </div>

        <button type="submit" disabled={isPending} className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Recipe"}
        </button>
      </form>
    </>
  );
}

function EditRecipeDialog({
  id, open, onOpenChange, ingredients, subRecipes, categoryDefaults,
}: {
  id: number; open: boolean; onOpenChange: (v: boolean) => void;
  ingredients: IngredientOption[];
  subRecipes: SubRecipeOption[];
  categoryDefaults: { category: string; defaultPackagingCost: number; defaultLabourCost: number }[];
}) {
  const { data: detail, isLoading } = useGetRecipe(id, { query: { enabled: open } });
  const { updateRecipe } = useAppMutations();

  if (!open) return null;

  const defaultValues: FormValues = detail
    ? {
        name: detail.name,
        category: detail.category ?? "",
        description: detail.description ?? "",
        servings: Number(detail.servings),
        servingUnit: detail.servingUnit,
        notes: detail.notes ?? "",
        packSize: Number((detail as any).packSize) || 1,
        rrp: Number((detail as any).rrp) || 0,
        packagingCost: Number((detail as any).packagingCost) || 0,
        labourCost: Number((detail as any).labourCost) || 0,
        portionsPerBatch: Number((detail as any).portionsPerBatch) || 10,
        ingredients: (detail.ingredients ?? []).map((i: any) => ({ ingredientId: i.ingredientId, quantity: Number(i.quantity) })),
        subRecipes: (detail.subRecipes ?? []).map((s: any) => ({ subRecipeId: s.subRecipeId, quantity: Number(s.quantity) })),
      }
    : { name: "", category: "", description: "", servings: 1, servingUnit: "portion", notes: "", packSize: 1, rrp: 0, packagingCost: 0, labourCost: 0, portionsPerBatch: 10, ingredients: [], subRecipes: [] };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-xl">Edit Recipe</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <RecipeForm
            key={id}
            defaultValues={defaultValues}
            isEdit
            isPending={updateRecipe.isPending}
            ingredients={ingredients}
            subRecipes={subRecipes}
            categoryDefaults={categoryDefaults}
            onSubmit={(data) => updateRecipe.mutate({ id, data }, { onSuccess: () => onOpenChange(false) })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Cost Breakdown Dialog ─────────────────────────────────────────────────────

type BreakdownIngredient = {
  ingredientName: string | null;
  unit: string | null;
  quantity: number;
  costPerUnit: number;
  allocatedCostBatch: number;
  allocatedCostPortion: number;
};

type BreakdownSubRecipe = {
  subRecipeId: number | null;
  subRecipeName: string | null;
  quantity: number;
  unit: string | null;
  subYield: number;
  subCostPerUnit: number;
  lineCostPortion: number;
  breakdown: BreakdownIngredient[];
};

type BreakdownRawIngredient = {
  ingredientName: string | null;
  unit: string | null;
  quantity: number;
  rawQuantity: number;
  processingRatio: number;
  costPerUnit: number;
  lineCostPortion: number;
};

function SubRecipeBreakdownRow({ sub, servingUnit }: { sub: BreakdownSubRecipe; servingUnit: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="bg-accent/5 border-t border-border/40">
        <td className="pl-4 pr-2 py-2.5">
          <button
            onClick={() => setOpen(v => !v)}
            className="flex items-center gap-1.5 font-medium text-accent hover:text-accent/80 transition-colors text-sm"
          >
            {open ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
            {sub.subRecipeName ?? "—"}
          </button>
        </td>
        <td className="px-2 py-2.5 text-xs text-muted-foreground text-right">
          {sub.quantity} {sub.unit}
        </td>
        <td className="px-2 py-2.5 text-xs text-muted-foreground text-right">
          £{fmt(sub.subCostPerUnit)}/{sub.unit}
        </td>
        <td className="px-2 py-2.5 text-right font-semibold text-sm">
          £{fmt(sub.lineCostPortion)}
          <span className="text-xs font-normal text-muted-foreground">/{servingUnit}</span>
        </td>
      </tr>
      {open && sub.breakdown.map((b, i) => (
        <tr key={i} className="bg-accent/5">
          <td className="pl-10 pr-2 py-1.5 text-xs text-muted-foreground flex items-center gap-1">
            <span className="text-accent/40 mr-1">└</span>{b.ingredientName ?? "—"}
          </td>
          <td className="px-2 py-1.5 text-xs text-muted-foreground text-right">
            {fmt(b.quantity)} {b.unit}
          </td>
          <td className="px-2 py-1.5 text-xs text-muted-foreground text-right">
            £{fmt(b.costPerUnit)}/{b.unit}
          </td>
          <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
            £{b.allocatedCostPortion.toFixed(4)}
            <span className="text-muted-foreground/60">/{servingUnit}</span>
          </td>
        </tr>
      ))}
    </>
  );
}

function RecipeCostBreakdownDialog({ id, open, onOpenChange }: { id: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: detail, isLoading } = useGetRecipe(id, { query: { enabled: open } });

  const d = detail as any;
  const servings = Number(d?.servings ?? 1);
  const servingUnit = d?.servingUnit ?? "portion";
  const rawIngredients: BreakdownRawIngredient[] = (d?.ingredients ?? []).map((i: any) => ({
    ingredientName: i.ingredientName,
    unit: i.unit,
    quantity: i.quantity,
    rawQuantity: i.rawQuantity ?? i.quantity,
    processingRatio: i.processingRatio ?? 1,
    costPerUnit: i.costPerUnit,
    lineCostPortion: i.lineCostPortion,
  }));
  const subRecipes: BreakdownSubRecipe[] = (d?.subRecipes ?? []).map((s: any) => ({
    subRecipeId: s.subRecipeId,
    subRecipeName: s.subRecipeName,
    quantity: s.quantity,
    unit: s.unit,
    subYield: s.subYield,
    subCostPerUnit: s.subCostPerUnit,
    lineCostPortion: s.lineCostPortion,
    breakdown: s.breakdown ?? [],
  }));

  const totalRaw = rawIngredients.reduce((a, r) => a + r.lineCostPortion, 0);
  const totalSub = subRecipes.reduce((a, s) => a + s.lineCostPortion, 0);
  const totalPerPortion = totalRaw + totalSub;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] bg-card border-border rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-primary" />
            Cost Breakdown — {d?.name ?? "…"}
          </DialogTitle>
          {d && (
            <p className="text-sm text-muted-foreground mt-0.5">
              Batch: {servings} {servingUnit} · All costs shown per {servingUnit}
            </p>
          )}
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4 mt-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/40 text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Ingredient / Prep item</th>
                  <th className="px-2 py-2 text-right font-medium">Cooked qty</th>
                  <th className="px-2 py-2 text-right font-medium">Cost / unit</th>
                  <th className="px-2 py-2 text-right font-medium">Per {servingUnit}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {/* Ingredients */}
                {rawIngredients.map((r, i) => (
                  <tr key={i} className="hover:bg-secondary/10">
                    <td className="pl-4 pr-2 py-2.5 font-medium text-sm">{r.ingredientName ?? "—"}</td>
                    <td className="px-2 py-2.5 text-right">
                      <span className="text-xs text-muted-foreground">{fmt(r.quantity)} {r.unit}</span>
                      {r.processingRatio < 1 && (
                        <span className="block text-xs text-muted-foreground/60">{r.rawQuantity.toFixed(4)} raw</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground text-right">£{fmt(r.costPerUnit)}/{r.unit}</td>
                    <td className="px-2 py-2.5 text-right font-semibold">
                      £{fmt(r.lineCostPortion)}
                      <span className="text-xs font-normal text-muted-foreground">/{servingUnit}</span>
                    </td>
                  </tr>
                ))}

                {/* Sub-recipes */}
                {subRecipes.map((s, i) => (
                  <SubRecipeBreakdownRow key={i} sub={s} servingUnit={servingUnit} />
                ))}

                {/* Total row */}
                <tr className="border-t-2 border-border bg-secondary/20">
                  <td colSpan={3} className="px-4 py-3 font-bold">Raw material cost</td>
                  <td className="px-2 py-3 text-right font-bold text-primary">
                    £{fmt(totalPerPortion)}/{servingUnit}
                  </td>
                </tr>

                {/* Packaging + labour if set */}
                {(Number(d?.packagingCost) > 0 || Number(d?.labourCost) > 0) && <>
                  {Number(d?.packagingCost) > 0 && (
                    <tr className="bg-secondary/10">
                      <td colSpan={3} className="px-4 py-2 text-sm text-muted-foreground flex items-center gap-2">
                        <Package className="w-3.5 h-3.5 inline mr-1" /> Packaging (per pack of {d?.packSize} {servingUnit})
                      </td>
                      <td className="px-2 py-2 text-right text-sm">£{fmt(Number(d?.packagingCost))}/pack</td>
                    </tr>
                  )}
                  {Number(d?.labourCost) > 0 && (
                    <tr className="bg-secondary/10">
                      <td colSpan={3} className="px-4 py-2 text-sm text-muted-foreground">
                        <Wrench className="w-3.5 h-3.5 inline mr-1" /> Labour (per pack)
                      </td>
                      <td className="px-2 py-2 text-right text-sm">£{fmt(Number(d?.labourCost))}/pack</td>
                    </tr>
                  )}
                  <tr className="bg-secondary/20">
                    <td colSpan={3} className="px-4 py-2.5 font-bold text-sm">Total pack cost</td>
                    <td className="px-2 py-2.5 text-right font-bold">£{fmt(Number(d?.totalPackCost))}/pack</td>
                  </tr>
                  {Number(d?.rrp) > 0 && (
                    <tr className="bg-secondary/10">
                      <td colSpan={3} className="px-4 py-2 text-sm font-medium">
                        Gross margin at £{fmt(Number(d?.rrp))} RRP
                      </td>
                      <td className="px-2 py-2 text-right">
                        <MarginBadge margin={d?.grossMargin} />
                      </td>
                    </tr>
                  )}
                </>}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Recipe Card & List ────────────────────────────────────────────────────────

type RecipeItem = {
  id: number; name: string; description?: string | null; category?: string | null;
  servings: number; servingUnit: string;
  packSize: number; rrp: number; packagingCost: number; labourCost: number;
  rawMaterialCostPerBatch: number; costPerPortion: number; packIngredientCost: number;
  totalPackCost: number; grossMargin: number | null;
};

function RecipeCard({ recipe, onEdit, onDelete, onBreakdown }: { recipe: RecipeItem; onEdit: () => void; onDelete: () => void; onBreakdown: () => void }) {
  const margin = recipe.grossMargin;
  const borderColor = margin == null ? "border-border" : margin >= 60 ? "border-green-300" : margin >= 50 ? "border-amber-300" : "border-red-300";
  const topBg = margin == null ? "from-primary/10 to-accent/10" : margin >= 60 ? "from-green-50 to-emerald-100" : margin >= 50 ? "from-amber-50 to-orange-100" : "from-red-50 to-pink-100";

  return (
    <div className={`rounded-2xl border-2 ${borderColor} bg-card overflow-hidden flex flex-col group hover:shadow-md transition-all`}>
      <div className={`bg-gradient-to-br ${topBg} flex flex-col justify-between px-5 pt-4 pb-3 gap-2`}>
        <div className="min-w-0">
          {recipe.category && <p className="text-xs font-semibold text-primary uppercase tracking-wider">{recipe.category}</p>}
          <p className="font-semibold text-sm leading-tight truncate">{recipe.name}</p>
        </div>
        <div className="flex items-center justify-between">
          <MarginBadge margin={margin} />
          <div className="flex items-center gap-1">
            <button onClick={onBreakdown} className="w-7 h-7 rounded-full bg-background/90 backdrop-blur text-primary flex items-center justify-center hover:bg-primary hover:text-white transition-colors shadow-sm" title="Cost Breakdown"><BarChart2 className="w-3 h-3" /></button>
            <button onClick={onEdit} className="w-7 h-7 rounded-full bg-background/90 backdrop-blur text-muted-foreground flex items-center justify-center hover:text-foreground transition-colors shadow-sm" title="Edit"><Edit2 className="w-3 h-3" /></button>
            <button onClick={onDelete} className="w-7 h-7 rounded-full bg-background/90 backdrop-blur text-destructive flex items-center justify-center hover:bg-destructive hover:text-white transition-colors shadow-sm" title="Delete"><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>
      </div>

      <div className="p-4 flex flex-col flex-1 gap-3">
        {recipe.description && <p className="text-xs text-muted-foreground line-clamp-2">{recipe.description}</p>}

        <MarginBar margin={margin} />

        {/* Cost breakdown */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <div className="text-muted-foreground">Recipe size</div>
          <div className="text-right font-medium">{recipe.servings} {recipe.servingUnit}</div>

          <div className="text-muted-foreground">Batch size</div>
          <div className="text-right font-medium">{recipe.portionsPerBatch} portions</div>

          <div className="text-muted-foreground">Pack of</div>
          <div className="text-right font-medium">{recipe.packSize} {recipe.servingUnit}</div>

          <div className="text-muted-foreground">Ingredients/pack</div>
          <div className="text-right font-medium">£{fmt(recipe.packIngredientCost)}</div>

          <div className="text-muted-foreground">Packaging</div>
          <div className="text-right font-medium">£{fmt(recipe.packagingCost)}</div>

          <div className="text-muted-foreground flex items-center gap-1"><Wrench className="w-3 h-3" /> Labour</div>
          <div className="text-right font-medium">£{fmt(recipe.labourCost)}</div>

          <div className="border-t border-border/60 pt-1 font-semibold">Total pack cost</div>
          <div className="border-t border-border/60 pt-1 text-right font-bold">£{fmt(recipe.totalPackCost)}</div>

          {recipe.rrp > 0 && (
            <>
              <div className="text-muted-foreground">RRP</div>
              <div className="text-right font-medium">£{fmt(recipe.rrp)}</div>
              <div className="text-muted-foreground">Gross profit</div>
              <div className={`text-right font-semibold ${margin != null && margin >= 60 ? "text-green-600" : margin != null && margin >= 50 ? "text-amber-600" : "text-red-600"}`}>
                £{fmt(recipe.rrp - recipe.totalPackCost)}
              </div>
            </>
          )}
        </div>

        {recipe.rrp === 0 && (
          <p className="text-xs text-muted-foreground italic text-center">Set an RRP to see margin</p>
        )}
      </div>
    </div>
  );
}

export default function Recipes() {
  const { data: recipes, isLoading } = useListRecipes();
  const { data: ingredients } = useListIngredients();
  const { data: subRecipesData } = useListSubRecipes();
  const { data: categoryDefaultsData } = useListCategoryDefaults();
  const { createRecipe, deleteRecipe } = useAppMutations();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [breakdownId, setBreakdownId] = useState<number | null>(null);

  const ingredientList: IngredientOption[] = (ingredients ?? []).map(i => ({
    id: i.id,
    name: i.name,
    unit: i.unit,
    processingRatio: Number((i as any).processingRatio) || 1,
    packWeight: Number((i as any).packWeight) || 0,
    costPerPack: Number((i as any).costPerPack) || 0,
  }));
  const subRecipeList: SubRecipeOption[] = (subRecipesData ?? []).map(s => ({
    id: s.id,
    name: s.name,
    yieldUnit: s.yieldUnit,
    costPerYieldUnit: Number((s as any).costPerYieldUnit) || 0,
  }));
  const catDefaults = (categoryDefaultsData ?? []).map(d => ({
    category: d.category,
    defaultPackagingCost: d.defaultPackagingCost,
    defaultLabourCost: d.defaultLabourCost,
  }));

  const addDefaults: FormValues = {
    name: "", category: "", description: "", servings: 1, servingUnit: "portion", notes: "",
    packSize: 1, rrp: 0, packagingCost: 0, labourCost: 0, portionsPerBatch: 10, ingredients: [], subRecipes: [],
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Final Product Recipes"
        description="Master recipes with full cost and margin calculations for your finished goods."
        action={
          <button onClick={() => setIsAddOpen(true)} className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 flex items-center gap-2 hover:bg-primary/90 transition-colors">
            <Plus className="w-5 h-5" /> Create Recipe
          </button>
        }
      />

      {/* Margin legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> ≥60% — Great</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-400 inline-block" /> 50–59% — OK</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> &lt;50% — Review</span>
      </div>

      {/* Add dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[720px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-xl">New Final Product</DialogTitle></DialogHeader>
          <RecipeForm
            defaultValues={addDefaults}
            isEdit={false}
            isPending={createRecipe.isPending}
            ingredients={ingredientList}
            subRecipes={subRecipeList}
            categoryDefaults={catDefaults}
            onSubmit={(data) => createRecipe.mutate({ data }, { onSuccess: () => setIsAddOpen(false) })}
          />
        </DialogContent>
      </Dialog>

      {/* Cost breakdown dialog */}
      {breakdownId !== null && (
        <RecipeCostBreakdownDialog
          id={breakdownId}
          open={breakdownId !== null}
          onOpenChange={(v) => { if (!v) setBreakdownId(null); }}
        />
      )}

      {/* Edit dialog */}
      {editingId !== null && (
        <EditRecipeDialog
          id={editingId}
          open={editingId !== null}
          onOpenChange={(v) => { if (!v) setEditingId(null); }}
          ingredients={ingredientList}
          subRecipes={subRecipeList}
          categoryDefaults={catDefaults}
        />
      )}

      {isLoading && <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}

      {!isLoading && recipes?.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <ChefHat className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No recipes yet</p>
          <p className="text-sm mt-1">Create your first product recipe above.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {recipes?.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe as RecipeItem}
            onEdit={() => setEditingId(recipe.id)}
            onDelete={() => { if (confirm(`Delete "${recipe.name}"?`)) deleteRecipe.mutate({ id: recipe.id }); }}
            onBreakdown={() => setBreakdownId(recipe.id)}
          />
        ))}
      </div>
    </div>
  );
}
