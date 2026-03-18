import { useState } from "react";
import { useListRecipes, useListIngredients, useListSubRecipes, useGetRecipe, useListCategoryDefaults } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { QuickAddIngredientDialog } from "@/components/quick-add-ingredient";
import { Plus, Trash2, ChefHat, X, Edit2, Loader2, TrendingUp, Package, Wrench } from "lucide-react";
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
  ingredients: { id: number; name: string; unit: string }[];
  subRecipes: { id: number; name: string; yieldUnit: string }[];
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
  const watchedPackSize = watch("packSize");
  const watchedRrp = watch("rrp");
  const watchedPackaging = watch("packagingCost");
  const watchedLabour = watch("labourCost");

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
    setLocalIngredients(prev => [...prev, ingredient]);
    if (quickAddTargetIndex !== null) {
      setValue(`ingredients.${quickAddTargetIndex}.ingredientId`, ingredient.id);
    }
    setQuickAddTargetIndex(null);
  };

  const overhead = (Number(watchedPackaging) || 0) + (Number(watchedLabour) || 0);
  const rrp = Number(watchedRrp) || 0;

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
            <label className="text-sm font-medium mb-1 block">Output / Batch size *</label>
            <div className="flex gap-2">
              <input type="number" step="0.001" {...register("servings")} className="w-24 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <input {...register("servingUnit")} className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="loaf, pack, slice…" />
            </div>
            {errors.servings && <span className="text-destructive text-xs">{errors.servings.message}</span>}
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

        {/* Ingredients & Sub-recipes */}
        <div className="border-t border-border pt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-bold text-primary">Raw Ingredients</label>
              <button type="button" onClick={() => appendIng({ ingredientId: 0, quantity: 1 })} className="text-xs font-medium bg-secondary px-2 py-1 rounded-md hover:bg-secondary/80 transition-colors">+ Add Row</button>
            </div>
            {ingFields.length === 0 && <p className="text-xs text-muted-foreground italic">No raw ingredients added</p>}
            <div className="space-y-2">
              {ingFields.map((field, index) => (
                <div key={field.id} className="flex gap-1.5 items-center">
                  <select {...register(`ingredients.${index}.ingredientId`)} className="flex-1 px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-0">
                    <option value={0} disabled>Select…</option>
                    {localIngredients.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                  </select>
                  <input type="number" step="0.001" {...register(`ingredients.${index}.quantity`)} className="w-16 px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 flex-shrink-0" placeholder="Qty" />
                  <button type="button" title="Create a new ingredient" onClick={() => openQuickAdd(index)} className="flex-shrink-0 px-2 py-1.5 rounded-lg border border-dashed border-primary/40 text-primary hover:bg-primary/10 transition-colors text-xs font-bold leading-none">+ New</button>
                  <button type="button" onClick={() => removeIng(index)} className="text-muted-foreground hover:text-destructive flex-shrink-0"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-bold text-accent">Prep Items (Sub-recipes)</label>
              <button type="button" onClick={() => appendSub({ subRecipeId: 0, quantity: 1 })} className="text-xs font-medium bg-secondary px-2 py-1 rounded-md hover:bg-secondary/80 transition-colors">+ Add Row</button>
            </div>
            {subFields.length === 0 && <p className="text-xs text-muted-foreground italic">No prep items added</p>}
            <div className="space-y-2">
              {subFields.map((field, index) => (
                <div key={field.id} className="flex gap-1.5 items-center">
                  <select {...register(`subRecipes.${index}.subRecipeId`)} className="flex-1 px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-0">
                    <option value={0} disabled>Select…</option>
                    {subRecipes.map(s => <option key={s.id} value={s.id}>{s.name} ({s.yieldUnit})</option>)}
                  </select>
                  <input type="number" step="0.001" {...register(`subRecipes.${index}.quantity`)} className="w-16 px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 flex-shrink-0" placeholder="Qty" />
                  <button type="button" onClick={() => removeSub(index)} className="text-muted-foreground hover:text-destructive flex-shrink-0"><X className="w-4 h-4" /></button>
                </div>
              ))}
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
  ingredients: { id: number; name: string; unit: string }[];
  subRecipes: { id: number; name: string; yieldUnit: string }[];
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
        ingredients: (detail.ingredients ?? []).map((i: any) => ({ ingredientId: i.ingredientId, quantity: Number(i.quantity) })),
        subRecipes: (detail.subRecipes ?? []).map((s: any) => ({ subRecipeId: s.subRecipeId, quantity: Number(s.quantity) })),
      }
    : { name: "", category: "", description: "", servings: 1, servingUnit: "portion", notes: "", packSize: 1, rrp: 0, packagingCost: 0, labourCost: 0, ingredients: [], subRecipes: [] };

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

type RecipeItem = {
  id: number; name: string; description?: string | null; category?: string | null;
  servings: number; servingUnit: string;
  packSize: number; rrp: number; packagingCost: number; labourCost: number;
  rawMaterialCostPerBatch: number; costPerPortion: number; packIngredientCost: number;
  totalPackCost: number; grossMargin: number | null;
};

function RecipeCard({ recipe, onEdit, onDelete }: { recipe: RecipeItem; onEdit: () => void; onDelete: () => void }) {
  const margin = recipe.grossMargin;
  const borderColor = margin == null ? "border-border" : margin >= 60 ? "border-green-300" : margin >= 50 ? "border-amber-300" : "border-red-300";
  const topBg = margin == null ? "from-primary/10 to-accent/10" : margin >= 60 ? "from-green-50 to-emerald-100" : margin >= 50 ? "from-amber-50 to-orange-100" : "from-red-50 to-pink-100";

  return (
    <div className={`rounded-2xl border-2 ${borderColor} bg-card overflow-hidden flex flex-col group hover:shadow-md transition-all`}>
      <div className={`h-20 bg-gradient-to-br ${topBg} relative flex items-center justify-between px-5`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-background/70 backdrop-blur flex items-center justify-center">
            <ChefHat className="w-5 h-5 text-primary/60" />
          </div>
          <div>
            {recipe.category && <p className="text-xs font-semibold text-primary uppercase tracking-wider">{recipe.category}</p>}
            <p className="font-semibold text-sm leading-tight truncate max-w-[160px]">{recipe.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <MarginBadge margin={margin} />
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
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
          <div className="text-muted-foreground">Batch size</div>
          <div className="text-right font-medium">{recipe.servings} {recipe.servingUnit}</div>

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

  const ingredientList = ingredients ?? [];
  const subRecipeList = subRecipesData ?? [];
  const catDefaults = (categoryDefaultsData ?? []).map(d => ({
    category: d.category,
    defaultPackagingCost: d.defaultPackagingCost,
    defaultLabourCost: d.defaultLabourCost,
  }));

  const addDefaults: FormValues = {
    name: "", category: "", description: "", servings: 1, servingUnit: "portion", notes: "",
    packSize: 1, rrp: 0, packagingCost: 0, labourCost: 0, ingredients: [], subRecipes: [],
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
          />
        ))}
      </div>
    </div>
  );
}
