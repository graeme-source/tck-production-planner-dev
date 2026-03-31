import { useState, useRef, useEffect } from "react";
import { useListRecipes, useListIngredients, useListSubRecipes, useGetRecipe, useListCategoryDefaults } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { QuickAddIngredientDialog } from "@/components/quick-add-ingredient";
import { Plus, Trash2, ChefHat, X, Edit2, Loader2, TrendingUp, Package, Wrench, ChevronDown, ChevronRight, BarChart2, Beaker, AlertTriangle, ClipboardList, Copy, QrCode } from "lucide-react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

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
  shelfLifeDays: z.coerce.number().int().nonnegative().optional(),
  tinSize: z.string().optional(),
  maxBatchesPerTin: z.preprocess(v => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable().optional()),
  sopUrl: z.string().optional(),
  isCoreMenu: z.boolean().optional(),
  isCurrentSpecial: z.boolean().optional(),
  color: z.string().optional(),
  cookingLossPercent: z.preprocess(v => (v === "" || v == null ? null : Number(v)), z.number().min(0).max(50).nullable().optional()),
  ingredients: z.array(z.object({
    ingredientId: z.coerce.number().min(1, "Select ingredient"),
    quantity: z.coerce.number().min(0.001, "Must be > 0"),
    marinadeForIngredientId: z.preprocess(v => (v === "" || v === "0" || v == null ? null : Number(v)), z.number().nullable().optional()),
    includeInFillingMix: z.boolean().optional(),
    isTopping: z.boolean().optional(),
  })),
  subRecipes: z.array(z.object({
    subRecipeId: z.coerce.number().min(1, "Select sub-recipe"),
    quantity: z.coerce.number().min(0.001, "Must be > 0"),
    marinadeForIngredientId: z.preprocess(v => (v === "" || v === "0" || v == null ? null : Number(v)), z.number().nullable().optional()),
    includeInFillingMix: z.boolean().optional(),
    isTopping: z.boolean().optional(),
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
  category?: string | null;
};

type SubRecipeOption = {
  id: number;
  name: string;
  yieldUnit: string;
  costPerYieldUnit: number;
};

function IngredientCombobox({ value, onChange, options }: { value: number; onChange: (id: number) => void; options: IngredientOption[] }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.id === Number(value));
  const filtered = options.filter(o => o.name.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      {open ? (
        <input
          ref={inputRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-2 py-1.5 bg-background border border-primary rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="Type to search…"
        />
      ) : (
        <button
          type="button"
          onClick={() => { setOpen(true); setSearch(""); }}
          className="w-full px-2 py-1.5 bg-background border border-border rounded-lg text-xs text-left focus:outline-none focus:ring-2 focus:ring-primary/30 truncate"
        >
          {selected
            ? <span>{selected.name} <span className="text-muted-foreground">({selected.unit})</span></span>
            : <span className="text-muted-foreground">Select…</span>
          }
        </button>
      )}

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.length === 0
            ? <p className="text-xs text-muted-foreground p-2 text-center italic">No ingredients found</p>
            : filtered.map(o => (
              <button
                key={o.id}
                type="button"
                onMouseDown={e => { e.preventDefault(); onChange(o.id); setOpen(false); setSearch(""); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors ${Number(value) === o.id ? "bg-accent font-medium" : ""}`}
              >
                {o.name} <span className="text-muted-foreground">({o.unit})</span>
              </button>
            ))
          }
        </div>
      )}
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
  currentSpecialName,
  thisRecipeIsSpecial,
  onDirtyChange,
  submitRef,
}: {
  defaultValues: FormValues;
  onSubmit: (data: FormValues) => void;
  isPending: boolean;
  isEdit: boolean;
  ingredients: IngredientOption[];
  subRecipes: SubRecipeOption[];
  categoryDefaults: { category: string; defaultPackagingCost: number; defaultLabourCost: number }[];
  currentSpecialName?: string | null;
  thisRecipeIsSpecial?: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
  submitRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const { register, control, handleSubmit, setValue, watch, formState: { errors, isDirty } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (submitRef) {
      submitRef.current = handleSubmit(onSubmit);
    }
  }, [submitRef, handleSubmit, onSubmit]);

  const { fields: ingFields, append: appendIng, remove: removeIng } = useFieldArray({ control, name: "ingredients" });
  const { fields: subFields, append: appendSub, remove: removeSub } = useFieldArray({ control, name: "subRecipes" });

  const [localIngredients, setLocalIngredients] = useState(initialIngredients);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddTargetIndex, setQuickAddTargetIndex] = useState<number | null>(null);
  // Per-row display unit for kg ingredients: "g" (default) or "kg"
  const [ingDisplayUnits, setIngDisplayUnits] = useState<Record<number, "g" | "kg">>({});
  const [subDisplayUnits, setSubDisplayUnits] = useState<Record<number, "g" | "kg">>({});

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
      setValue("packSize", (def as Record<string, unknown>).defaultPackSize as number ?? 1);
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

      <form onSubmit={handleSubmit((data) => {
        onSubmit(data);
      })} className="space-y-5 mt-4">
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
              <p className="text-xs text-primary mt-0.5">Defaults applied from category preset.</p>
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
          <div>
            <label className="text-sm font-medium mb-1 block">Shelf Life (days)</label>
            <input type="number" step="1" min="0" {...register("shelfLifeDays")} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="e.g. 3" />
            {errors.shelfLifeDays && <span className="text-destructive text-xs">{errors.shelfLifeDays.message}</span>}
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Cooking Loss %</label>
            <input type="number" step="0.5" min="0" max="50" {...register("cookingLossPercent")} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="3" />
            <p className="text-xs text-muted-foreground mt-0.5">Weight lost during cooking (default 3%)</p>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Tin Size</label>
            <input {...register("tinSize")} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="e.g. 2lb, 4lb…" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Max Batches per Tin</label>
            <input type="number" step="1" min="1" {...register("maxBatchesPerTin")} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="e.g. 4" />
            {errors.maxBatchesPerTin && <span className="text-destructive text-xs">{String(errors.maxBatchesPerTin.message)}</span>}
          </div>
          <div className="col-span-2">
            <label className="text-sm font-medium mb-1 block">SOP URL</label>
            <input type="url" {...register("sopUrl")} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="https://…" />
          </div>
          <div className="col-span-2 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="isCoreMenu" {...register("isCoreMenu")} className="rounded border-border" />
              <label htmlFor="isCoreMenu" className="text-sm font-medium">Core Menu Item</label>
              <span className="text-xs text-muted-foreground">(always shows in Production Fridge stock &amp; calculator)</span>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="isCurrentSpecial" {...register("isCurrentSpecial")} className="rounded border-border" />
                <label htmlFor="isCurrentSpecial" className="text-sm font-medium">Calzone Club Special</label>
              </div>
              <span className="text-xs text-muted-foreground pl-5">"Calzone Club Special" Shopify orders count towards this recipe's sales total.</span>
              {thisRecipeIsSpecial && (
                <span className="text-xs text-primary font-medium pl-5">This recipe is currently the Calzone Club Special.</span>
              )}
              {!thisRecipeIsSpecial && currentSpecialName && (
                <span className="text-xs text-amber-600 dark:text-amber-400 pl-5">Currently set to: <strong>{currentSpecialName}</strong>. Enabling this will replace it.</span>
              )}
              {!thisRecipeIsSpecial && !currentSpecialName && (
                <span className="text-xs text-muted-foreground pl-5">No Calzone Club Special is currently set.</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="recipeColor" className="text-sm font-medium">Colour</label>
              <input type="color" id="recipeColor" {...register("color")} className="w-8 h-8 rounded border border-border cursor-pointer p-0.5" />
              {watch("color") && (
                <button type="button" onClick={() => setValue("color", "")} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
              )}
            </div>
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
        {(() => {
          const rawMeatIngs = (watchedIngredients ?? [])
            .map(wi => localIngredients.find(i => i.id === Number(wi.ingredientId)))
            .filter((i): i is IngredientOption => !!i && i.category === "raw_meat");

          return (
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
                  <button type="button" onClick={() => appendIng({ ingredientId: 0, quantity: 0, marinadeForIngredientId: null, includeInFillingMix: false, isTopping: false })} className="text-xs font-medium bg-secondary px-2 py-1 rounded-md hover:bg-secondary/80 transition-colors">+ Add</button>
                </div>
                {ingFields.length === 0 && <p className="text-xs text-muted-foreground italic pl-1 pb-1">No ingredients added</p>}
                <div className="space-y-1.5">
                  {ingFields.map((field, index) => {
                    const cost = ingLineCost(index);
                    const thisIng = localIngredients.find(i => i.id === Number(watchedIngredients?.[index]?.ingredientId));
                    const isRawMeat = thisIng?.category === "raw_meat";
                    const ingMarinadeVal = watchedIngredients?.[index]?.marinadeForIngredientId;
                    const ingMarinadeSet = ingMarinadeVal != null && ingMarinadeVal !== "" && ingMarinadeVal !== 0 && ingMarinadeVal !== "0";
                    return (
                      <div key={field.id} className="space-y-0.5">
                        <div className="grid grid-cols-[1fr_6rem_4.5rem_auto_auto_1.25rem] gap-2 items-center">
                          <div className="flex gap-1 min-w-0">
                            <Controller
                              control={control}
                              name={`ingredients.${index}.ingredientId`}
                              render={({ field }) => (
                                <IngredientCombobox
                                  value={Number(field.value)}
                                  onChange={id => field.onChange(id)}
                                  options={localIngredients}
                                />
                              )}
                            />
                            <button type="button" title="Create a new ingredient" onClick={() => openQuickAdd(index)} className="flex-shrink-0 px-1.5 py-1.5 rounded-lg border border-dashed border-primary/40 text-primary hover:bg-primary/10 transition-colors text-xs font-bold leading-none">+</button>
                          </div>
                          {(() => {
                            const isKg = thisIng?.unit === "kg";
                            const displayUnit = isKg ? (ingDisplayUnits[index] ?? "g") : null;
                            const storedKg = Number(watchedIngredients?.[index]?.quantity) || 0;
                            if (!isKg) {
                              return <input type="number" step="0.0001" {...register(`ingredients.${index}.quantity`)} className="w-full px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="0.000" />;
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
                                  className="min-w-0 flex-1 w-0 px-2 py-1.5 bg-background border border-border rounded-l-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                                  placeholder={displayUnit === "g" ? "e.g. 250" : "0.000"}
                                />
                                <div className="flex flex-col shrink-0 text-[9px] font-semibold overflow-hidden border border-l-0 border-border rounded-r-lg">
                                  <button type="button" onClick={() => setIngDisplayUnits(u => ({ ...u, [index]: "g" }))} className={cn("px-1 flex-1 transition-colors", displayUnit === "g" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>g</button>
                                  <button type="button" onClick={() => setIngDisplayUnits(u => ({ ...u, [index]: "kg" }))} className={cn("px-1 flex-1 border-t border-border transition-colors", displayUnit === "kg" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>kg</button>
                                </div>
                              </div>
                            );
                          })()}
                          <span className="text-xs tabular-nums text-right text-muted-foreground">
                            {cost !== null ? `£${(Math.ceil(cost * 100) / 100).toFixed(2)}` : "—"}
                          </span>
                          <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap" title="Include in filling mix">
                            <input type="checkbox" {...register(`ingredients.${index}.includeInFillingMix`)} className="rounded border-border text-primary focus:ring-primary/30 w-3 h-3" />
                            <span className="text-[10px] text-muted-foreground">Filling</span>
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap" title="Topping — skips prep, shown in building checklist">
                            <input type="checkbox" {...register(`ingredients.${index}.isTopping`)} className="rounded border-border text-amber-500 focus:ring-amber-500/30 w-3 h-3" />
                            <span className="text-[10px] text-muted-foreground">Topping</span>
                          </label>
                          <button type="button" onClick={() => removeIng(index)} className="text-muted-foreground hover:text-destructive flex justify-center"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        {!isRawMeat && rawMeatIngs.length > 0 && (
                          ingMarinadeSet ? (
                            <div className="pl-1 flex items-center gap-1.5">
                              <select
                                {...register(`ingredients.${index}.marinadeForIngredientId`)}
                                className="px-1.5 py-0.5 bg-muted/50 border border-border rounded text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                              >
                                <option value="">Not a marinade</option>
                                {rawMeatIngs.map(m => <option key={m.id} value={m.id}>Marinade for {m.name}</option>)}
                              </select>
                              <button type="button" onClick={() => setValue(`ingredients.${index}.marinadeForIngredientId`, null)} className="text-muted-foreground/60 hover:text-muted-foreground"><X className="w-3 h-3" /></button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => { setValue(`ingredients.${index}.marinadeForIngredientId`, rawMeatIngs[0]?.id ?? 0); }} className="pl-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                              + Mark as marinade
                            </button>
                          )
                        )}
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
                  <button type="button" onClick={() => appendSub({ subRecipeId: 0, quantity: 0, marinadeForIngredientId: null, includeInFillingMix: false, isTopping: false })} className="text-xs font-medium bg-secondary px-2 py-1 rounded-md hover:bg-secondary/80 transition-colors">+ Add</button>
                </div>
                {subFields.length === 0 && <p className="text-xs text-muted-foreground italic pl-1 pb-1">No prep items added</p>}
                <div className="space-y-1.5">
                  {subFields.map((field, index) => {
                    const cost = subLineCost(index);
                    const subMarinadeVal = watchedSubRecipes?.[index]?.marinadeForIngredientId;
                    const subMarinadeSet = subMarinadeVal != null && subMarinadeVal !== "" && subMarinadeVal !== 0 && subMarinadeVal !== "0";
                    return (
                      <div key={field.id} className="space-y-0.5">
                        <div className="grid grid-cols-[1fr_6rem_4.5rem_auto_auto_1.25rem] gap-2 items-center">
                          <select {...register(`subRecipes.${index}.subRecipeId`)} className="min-w-0 px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30">
                            <option value={0} disabled>Select…</option>
                            {subRecipes.map(s => <option key={s.id} value={s.id}>{s.name} ({s.yieldUnit})</option>)}
                          </select>
                          {(() => {
                            const thisSub = subRecipes.find(s => s.id === Number(watchedSubRecipes?.[index]?.subRecipeId));
                            const isKg = thisSub?.yieldUnit === "kg";
                            const displayUnit = isKg ? (subDisplayUnits[index] ?? "g") : null;
                            const storedKg = Number(watchedSubRecipes?.[index]?.quantity) || 0;
                            if (!isKg) {
                              return <input type="number" step="0.0001" {...register(`subRecipes.${index}.quantity`)} className="w-full px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="0.000" />;
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
                                    setValue(`subRecipes.${index}.quantity`, displayUnit === "g" ? v / 1000 : v, { shouldValidate: true });
                                  }}
                                  className="min-w-0 flex-1 w-0 px-2 py-1.5 bg-background border border-border rounded-l-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                                  placeholder={displayUnit === "g" ? "e.g. 250" : "0.000"}
                                />
                                <div className="flex flex-col shrink-0 text-[9px] font-semibold overflow-hidden border border-l-0 border-border rounded-r-lg">
                                  <button type="button" onClick={() => setSubDisplayUnits(u => ({ ...u, [index]: "g" }))} className={cn("px-1 flex-1 transition-colors", displayUnit === "g" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>g</button>
                                  <button type="button" onClick={() => setSubDisplayUnits(u => ({ ...u, [index]: "kg" }))} className={cn("px-1 flex-1 border-t border-border transition-colors", displayUnit === "kg" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>kg</button>
                                </div>
                              </div>
                            );
                          })()}
                          <span className="text-xs tabular-nums text-right text-muted-foreground">
                            {cost !== null ? `£${(Math.ceil(cost * 100) / 100).toFixed(2)}` : "—"}
                          </span>
                          <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap" title="Include in filling mix">
                            <input type="checkbox" {...register(`subRecipes.${index}.includeInFillingMix`)} className="rounded border-border text-primary focus:ring-primary/30 w-3 h-3" />
                            <span className="text-[10px] text-muted-foreground">Filling</span>
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap" title="Topping — skips prep, shown in building checklist">
                            <input type="checkbox" {...register(`subRecipes.${index}.isTopping`)} className="rounded border-border text-amber-500 focus:ring-amber-500/30 w-3 h-3" />
                            <span className="text-[10px] text-muted-foreground">Topping</span>
                          </label>
                          <button type="button" onClick={() => removeSub(index)} className="text-muted-foreground hover:text-destructive flex justify-center"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        {rawMeatIngs.length > 0 && (
                          subMarinadeSet ? (
                            <div className="pl-1 flex items-center gap-1.5">
                              <select
                                {...register(`subRecipes.${index}.marinadeForIngredientId`)}
                                className="px-1.5 py-0.5 bg-muted/50 border border-border rounded text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                              >
                                <option value="">Not a marinade</option>
                                {rawMeatIngs.map(m => <option key={m.id} value={m.id}>Marinade for {m.name}</option>)}
                              </select>
                              <button type="button" onClick={() => setValue(`subRecipes.${index}.marinadeForIngredientId`, null)} className="text-muted-foreground/60 hover:text-muted-foreground"><X className="w-3 h-3" /></button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => { setValue(`subRecipes.${index}.marinadeForIngredientId`, rawMeatIngs[0]?.id ?? 0); }} className="pl-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                              + Mark as marinade
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

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

interface ShopifyVariantOption {
  variantId: string;
  productTitle: string;
  variantTitle: string | null;
  display: string;
}

interface ShopifyMapping {
  shopify_variant_id: string;
  shopify_product_title: string | null;
  shopify_variant_title: string | null;
  wonky_variant_id: string | null;
  wonky_product_title: string | null;
  wonky_variant_title: string | null;
}

function EditRecipeDialog({
  id, open, onOpenChange, ingredients, subRecipes, categoryDefaults,
}: {
  id: number; open: boolean; onOpenChange: (v: boolean) => void;
  ingredients: IngredientOption[];
  subRecipes: SubRecipeOption[];
  categoryDefaults: { category: string; defaultPackagingCost: number; defaultLabourCost: number }[];
}) {
  const { state: authState } = useAuth();
  const canEditShopify = authState.status === "authenticated" &&
    (authState.user.role === "admin" || authState.user.role === "manager");

  const { data: detail, isLoading } = useGetRecipe(id, { query: { enabled: open } });
  const { data: allRecipes } = useListRecipes({ query: { enabled: open } });
  const { updateRecipe } = useAppMutations();

  const [formIsDirty, setFormIsDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const submitRef = useRef<(() => void) | null>(null);

  // Shopify link state
  const [shopifyMapping, setShopifyMapping] = useState<ShopifyMapping | null>(null);
  const [shopifyVariants, setShopifyVariants] = useState<ShopifyVariantOption[]>([]);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyProductsLoading, setShopifyProductsLoading] = useState(false);
  const [shopifySaving, setShopifySaving] = useState(false);
  const [shopifySearch, setShopifySearch] = useState("");
  const [selectedVariant, setSelectedVariant] = useState<ShopifyVariantOption | null>(null);
  const [shopifyError, setShopifyError] = useState<string | null>(null);
  const [wonkySearch, setWonkySearch] = useState("");
  const [selectedWonkyVariant, setSelectedWonkyVariant] = useState<ShopifyVariantOption | null>(null);
  const [shopifyEditing, setShopifyEditing] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Load current mapping
    setShopifyLoading(true);
    fetch(`/api/recipes/${id}/shopify-mapping`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((data: ShopifyMapping | null) => {
        setShopifyMapping(data);
        setSelectedVariant(data ? {
          variantId: data.shopify_variant_id,
          productTitle: data.shopify_product_title ?? "",
          variantTitle: data.shopify_variant_title ?? null,
          display: data.shopify_variant_title
            ? `${data.shopify_product_title ?? ""} – ${data.shopify_variant_title}`
            : (data.shopify_product_title ?? ""),
        } : null);
        setSelectedWonkyVariant(data?.wonky_variant_id ? {
          variantId: data.wonky_variant_id,
          productTitle: data.wonky_product_title ?? "",
          variantTitle: data.wonky_variant_title ?? null,
          display: data.wonky_variant_title
            ? `${data.wonky_product_title ?? ""} – ${data.wonky_variant_title}`
            : (data.wonky_product_title ?? ""),
        } : null);
      })
      .catch(() => setShopifyMapping(null))
      .finally(() => setShopifyLoading(false));

    // Load Shopify products for picker
    setShopifyProductsLoading(true);
    fetch("/api/shopify/products", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((products: Array<{ id: number; title: string; variants: Array<{ id: number; title: string; sku: string }> }>) => {
        const opts: ShopifyVariantOption[] = [];
        for (const p of products) {
          for (const v of p.variants) {
            const hasMultipleVariants = p.variants.length > 1;
            const variantTitle = hasMultipleVariants && v.title !== "Default Title" ? v.title : null;
            opts.push({
              variantId: String(v.id),
              productTitle: p.title,
              variantTitle,
              display: variantTitle ? `${p.title} – ${variantTitle}` : p.title,
            });
          }
        }
        setShopifyVariants(opts);
      })
      .catch(() => {})
      .finally(() => setShopifyProductsLoading(false));
  }, [open, id]);

  async function saveShopifyMapping() {
    if (!selectedVariant) return;
    setShopifySaving(true);
    setShopifyError(null);
    try {
      const res = await fetch(`/api/recipes/${id}/shopify-mapping`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopifyVariantId: selectedVariant.variantId,
          shopifyProductTitle: selectedVariant.productTitle,
          shopifyVariantTitle: selectedVariant.variantTitle,
          wonkyVariantId: selectedWonkyVariant?.variantId ?? null,
          wonkyProductTitle: selectedWonkyVariant?.productTitle ?? null,
          wonkyVariantTitle: selectedWonkyVariant?.variantTitle ?? null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      const saved = await res.json() as ShopifyMapping;
      setShopifyMapping(saved);
      setShopifyEditing(false);
    } catch (err) {
      setShopifyError(err instanceof Error ? err.message : "Failed to save mapping");
    } finally {
      setShopifySaving(false);
    }
  }

  async function removeShopifyMapping() {
    setShopifySaving(true);
    setShopifyError(null);
    try {
      await fetch(`/api/recipes/${id}/shopify-mapping`, { method: "DELETE", credentials: "include" });
      setShopifyMapping(null);
      setSelectedVariant(null);
      setSelectedWonkyVariant(null);
      setShopifySearch("");
      setWonkySearch("");
    } catch (err) {
      setShopifyError(err instanceof Error ? err.message : "Failed to remove mapping");
    } finally {
      setShopifySaving(false);
    }
  }

  const specialRecipe = allRecipes?.find((r) => r.isCurrentSpecial);
  const currentSpecialName = specialRecipe ? specialRecipe.name : null;
  const thisRecipeIsSpecial = detail?.isCurrentSpecial ?? false;

  function handleOpenChange(v: boolean) {
    if (!v && formIsDirty) {
      setConfirmOpen(true);
    } else {
      if (!v) setShopifyEditing(false);
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

  if (!open) return null;

  const defaultValues: FormValues = detail
    ? {
        name: detail.name,
        category: detail.category ?? "",
        description: detail.description ?? "",
        servings: Number(detail.servings),
        servingUnit: detail.servingUnit,
        notes: detail.notes ?? "",
        packSize: Number(detail.packSize) || 1,
        rrp: Number(detail.rrp) || 0,
        packagingCost: Number(detail.packagingCost) || 0,
        labourCost: Number(detail.labourCost) || 0,
        portionsPerBatch: Number(detail.portionsPerBatch) || 10,
        shelfLifeDays: detail.shelfLifeDays != null ? Number(detail.shelfLifeDays) : undefined,
        tinSize: detail.tinSize ?? "",
        maxBatchesPerTin: detail.maxBatchesPerTin != null ? Number(detail.maxBatchesPerTin) : null,
        sopUrl: detail.sopUrl ?? "",
        isCoreMenu: detail.isCoreMenu ?? false,
        isCurrentSpecial: detail.isCurrentSpecial ?? false,
        color: detail.color ?? "",
        cookingLossPercent: (detail as Record<string, unknown>).cookingLossPercent != null ? Number((detail as Record<string, unknown>).cookingLossPercent) : 3,
        ingredients: (detail.ingredients ?? []).map(i => ({ ingredientId: i.ingredientId, quantity: Number(i.quantity), marinadeForIngredientId: i.marinadeForIngredientId ?? null, includeInFillingMix: i.includeInFillingMix ?? false, isTopping: (i as Record<string, unknown>).isTopping === true })),
        subRecipes: (detail.subRecipes ?? []).map(s => ({ subRecipeId: s.subRecipeId, quantity: Number(s.quantity), marinadeForIngredientId: s.marinadeForIngredientId ?? null, includeInFillingMix: s.includeInFillingMix ?? false, isTopping: (s as Record<string, unknown>).isTopping === true })),
      }
    : { name: "", category: "", description: "", servings: 1, servingUnit: "portion", notes: "", packSize: 1, rrp: 0, packagingCost: 0, labourCost: 0, portionsPerBatch: 10, shelfLifeDays: undefined, tinSize: "", maxBatchesPerTin: null, sopUrl: "", isCoreMenu: false, isCurrentSpecial: false, color: "", cookingLossPercent: 3, ingredients: [], subRecipes: [] };

  return (
    <>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="bg-card border-border rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this recipe. What would you like to do?
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
          <DialogHeader><DialogTitle className="font-display text-xl">Edit Recipe</DialogTitle></DialogHeader>
          {isLoading ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <RecipeForm
                key={id}
                defaultValues={defaultValues}
                isEdit
                isPending={updateRecipe.isPending}
                ingredients={ingredients}
                subRecipes={subRecipes}
                categoryDefaults={categoryDefaults}
                currentSpecialName={currentSpecialName}
                thisRecipeIsSpecial={thisRecipeIsSpecial}
                onDirtyChange={setFormIsDirty}
                submitRef={submitRef}
                onSubmit={(data) => updateRecipe.mutate({ id, data }, { onSuccess: () => onOpenChange(false) })}
              />

              {/* Shopify Inventory Link */}
              <div className="mt-4 border-t border-border pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-4 h-4 text-[#96bf48]" viewBox="0 0 24 24" fill="currentColor"><path d="M20.924 7.625a1.523 1.523 0 0 0-1.238-1.044l-1.822-.187-.88-2.062A1.5 1.5 0 0 0 15.6 3.5H8.4a1.5 1.5 0 0 0-1.384.832l-.88 2.062-1.822.187A1.523 1.523 0 0 0 3.076 7.625L2 17.5A1.5 1.5 0 0 0 3.5 19h17a1.5 1.5 0 0 0 1.5-1.5zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>
                  <h4 className="text-sm font-semibold">Shopify Inventory Link</h4>
                  {shopifyLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                </div>

                {shopifyMapping && !shopifyEditing ? (
                  <div className="space-y-3">
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-0.5">Main Product</p>
                          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                            {shopifyMapping.shopify_product_title ?? "Shopify product"}
                            {shopifyMapping.shopify_variant_title && (
                              <span className="text-emerald-700 dark:text-emerald-300 font-normal"> – {shopifyMapping.shopify_variant_title}</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">Variant ID: {shopifyMapping.shopify_variant_id}</p>
                        </div>
                        {canEditShopify && (
                          <div className="flex gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => setShopifyEditing(true)}
                              className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-foreground hover:bg-secondary/50 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={removeShopifyMapping}
                              disabled={shopifySaving}
                              className="text-xs px-2.5 py-1.5 rounded-lg border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                            >
                              {shopifySaving ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Remove"}
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">Net packs → Shopify inventory when wrapping completes.</p>
                    </div>
                    {shopifyMapping.wonky_variant_id ? (
                      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-0.5">Wonky / F2F Product</p>
                            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                              {shopifyMapping.wonky_product_title ?? "Shopify product"}
                              {shopifyMapping.wonky_variant_title && (
                                <span className="text-amber-700 dark:text-amber-300 font-normal"> – {shopifyMapping.wonky_variant_title}</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">Variant ID: {shopifyMapping.wonky_variant_id}</p>
                          </div>
                        </div>
                        <p className="text-xs text-amber-700 dark:text-amber-300">Wonky packs → this F2F product when transferred to freezer.</p>
                      </div>
                    ) : canEditShopify ? (
                      <p className="text-xs text-muted-foreground italic">No wonky/F2F product linked. <button type="button" onClick={() => setShopifyEditing(true)} className="underline hover:text-foreground">Add one</button></p>
                    ) : null}
                  </div>
                ) : canEditShopify || shopifyEditing ? (
                  <div className="space-y-3">
                    {shopifyEditing && shopifyMapping && (
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-foreground">Editing Shopify links</p>
                        <button type="button" onClick={() => setShopifyEditing(false)} className="text-xs text-muted-foreground hover:text-foreground underline">Cancel</button>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">{shopifyEditing ? "Update the Shopify product links for this recipe." : "Link this recipe to Shopify products. Inventory will auto-sync when wrapping is completed."}</p>
                    {shopifyProductsLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                        <Loader2 className="w-3 h-3 animate-spin" /> Loading Shopify products…
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-1">Main Product</p>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="Search Shopify products…"
                              value={shopifySearch}
                              onChange={e => setShopifySearch(e.target.value)}
                              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                            {shopifySearch && (
                              <div className="absolute top-full left-0 right-0 z-10 bg-card border border-border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                                {shopifyVariants
                                  .filter(v => v.display.toLowerCase().includes(shopifySearch.toLowerCase()))
                                  .slice(0, 20)
                                  .map(v => (
                                    <button
                                      key={v.variantId}
                                      type="button"
                                      onClick={() => { setSelectedVariant(v); setShopifySearch(""); }}
                                      className="w-full text-left px-3 py-2 text-sm hover:bg-secondary/50 transition-colors"
                                    >
                                      {v.display}
                                    </button>
                                  ))}
                                {shopifyVariants.filter(v => v.display.toLowerCase().includes(shopifySearch.toLowerCase())).length === 0 && (
                                  <p className="px-3 py-2 text-sm text-muted-foreground italic">No products found</p>
                                )}
                              </div>
                            )}
                          </div>
                          {selectedVariant && (
                            <div className="flex items-center gap-2 p-2 bg-secondary/30 rounded-lg text-sm mt-1">
                              <span className="flex-1 font-medium truncate">{selectedVariant.display}</span>
                              <button type="button" onClick={() => setSelectedVariant(null)} className="text-muted-foreground hover:text-foreground">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-1">Wonky / F2F Product <span className="font-normal text-muted-foreground">(optional)</span></p>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="Search F2F products…"
                              value={wonkySearch}
                              onChange={e => setWonkySearch(e.target.value)}
                              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300/30"
                            />
                            {wonkySearch && (
                              <div className="absolute top-full left-0 right-0 z-10 bg-card border border-border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                                {shopifyVariants
                                  .filter(v => v.display.toLowerCase().includes(wonkySearch.toLowerCase()))
                                  .slice(0, 20)
                                  .map(v => (
                                    <button
                                      key={v.variantId}
                                      type="button"
                                      onClick={() => { setSelectedWonkyVariant(v); setWonkySearch(""); }}
                                      className="w-full text-left px-3 py-2 text-sm hover:bg-secondary/50 transition-colors"
                                    >
                                      {v.display}
                                    </button>
                                  ))}
                                {shopifyVariants.filter(v => v.display.toLowerCase().includes(wonkySearch.toLowerCase())).length === 0 && (
                                  <p className="px-3 py-2 text-sm text-muted-foreground italic">No products found</p>
                                )}
                              </div>
                            )}
                          </div>
                          {selectedWonkyVariant && (
                            <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm mt-1">
                              <span className="flex-1 font-medium truncate">{selectedWonkyVariant.display}</span>
                              <button type="button" onClick={() => setSelectedWonkyVariant(null)} className="text-muted-foreground hover:text-foreground">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={saveShopifyMapping}
                          disabled={!selectedVariant || shopifySaving}
                          className="w-full py-2 px-4 rounded-xl bg-[#96bf48] text-white text-sm font-medium hover:bg-[#7da33c] transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                        >
                          {shopifySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          {shopifySaving ? "Saving…" : shopifyEditing ? "Update Shopify Links" : "Link to Shopify"}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No Shopify product linked. Contact an admin to set up the link.</p>
                )}
                {shopifyError && <p className="text-xs text-destructive mt-1">{shopifyError}</p>}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
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

  const servings = Number(detail?.servings ?? 1);
  const servingUnit = detail?.servingUnit ?? "portion";
  const rawIngredients: BreakdownRawIngredient[] = (detail?.ingredients ?? []).map(i => ({
    ingredientName: i.ingredientName,
    unit: i.unit,
    quantity: i.quantity,
    rawQuantity: i.rawQuantity ?? i.quantity,
    processingRatio: i.processingRatio ?? 1,
    costPerUnit: i.costPerUnit ?? 0,
    lineCostPortion: i.lineCostPortion ?? 0,
  }));
  const subRecipes: BreakdownSubRecipe[] = (detail?.subRecipes ?? []).map(s => ({
    subRecipeId: s.subRecipeId,
    subRecipeName: s.subRecipeName,
    quantity: s.quantity,
    unit: s.unit,
    subYield: s.subYield ?? 0,
    subCostPerUnit: s.subCostPerUnit ?? 0,
    lineCostPortion: s.lineCostPortion ?? 0,
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
            Cost Breakdown — {detail?.name ?? "…"}
          </DialogTitle>
          {detail && (
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
                {(Number(detail?.packagingCost) > 0 || Number(detail?.labourCost) > 0) && <>
                  {Number(detail?.packagingCost) > 0 && (
                    <tr className="bg-secondary/10">
                      <td colSpan={3} className="px-4 py-2 text-sm text-muted-foreground flex items-center gap-2">
                        <Package className="w-3.5 h-3.5 inline mr-1" /> Packaging (per pack of {detail?.packSize} {servingUnit})
                      </td>
                      <td className="px-2 py-2 text-right text-sm">£{fmt(Number(detail?.packagingCost))}/pack</td>
                    </tr>
                  )}
                  {Number(detail?.labourCost) > 0 && (
                    <tr className="bg-secondary/10">
                      <td colSpan={3} className="px-4 py-2 text-sm text-muted-foreground">
                        <Wrench className="w-3.5 h-3.5 inline mr-1" /> Labour (per pack)
                      </td>
                      <td className="px-2 py-2 text-right text-sm">£{fmt(Number(detail?.labourCost))}/pack</td>
                    </tr>
                  )}
                  <tr className="bg-secondary/20">
                    <td colSpan={3} className="px-4 py-2.5 font-bold text-sm">Total pack cost</td>
                    <td className="px-2 py-2.5 text-right font-bold">£{fmt(Number(detail?.totalPackCost))}/pack</td>
                  </tr>
                  {Number(detail?.rrp) > 0 && (
                    <tr className="bg-secondary/10">
                      <td colSpan={3} className="px-4 py-2 text-sm font-medium">
                        Gross margin at £{fmt(Number(detail?.rrp))} RRP
                      </td>
                      <td className="px-2 py-2 text-right">
                        <MarginBadge margin={detail?.grossMargin} />
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

interface NutritionalsData {
  totalRawWeightG: number;
  cookingLossPercent: number;
  cookedWeightG: number;
  portionsPerBatch: number;
  portionWeightG: number;
  per100g: Record<string, number | null>;
  perPortion: Record<string, number | null>;
  completeness: { totalIngredients: number; missingNutritionals: string[]; missingDeclarations: string[]; isComplete: boolean };
}

interface DeckData {
  ingredients: { ingredientId: number; name: string; declaration: string; percentage: number; allergens: string[] }[];
  deckText: string;
  allergens: string[];
  mayContainStatement: string | null;
  missingDeclarations: string[];
  isComplete: boolean;
}

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

function RecipeNutritionalsDialog({ id, open, onOpenChange }: { id: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [data, setData] = useState<NutritionalsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch(`${BASE_URL}/api/recipes/${id}/nutritionals`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, id]);

  const nutrientLabels: Record<string, string> = {
    energyKj: "Energy (kJ)", energyKcal: "Energy (kcal)", fat: "Fat", saturates: "  of which saturates",
    carbohydrate: "Carbohydrate", sugars: "  of which sugars", protein: "Protein", fibre: "Fibre", salt: "Salt",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] bg-card border-border rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2"><Beaker className="w-5 h-5" /> Nutritional Information</DialogTitle>
        </DialogHeader>
        {loading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
        {error && <p className="text-destructive text-sm py-4">{error}</p>}
        {data && (
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="bg-secondary/30 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Raw Weight</p>
                <p className="font-bold">{data.totalRawWeightG}g</p>
              </div>
              <div className="bg-secondary/30 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Cooked Weight</p>
                <p className="font-bold">{data.cookedWeightG}g</p>
                <p className="text-[10px] text-muted-foreground">(-{data.cookingLossPercent}% loss)</p>
              </div>
              <div className="bg-secondary/30 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Portion Weight</p>
                <p className="font-bold">{data.portionWeightG}g</p>
                <p className="text-[10px] text-muted-foreground">({data.portionsPerBatch} portions)</p>
              </div>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 font-semibold">Nutrient</th>
                  <th className="text-right py-1.5 font-semibold">Per 100g</th>
                  <th className="text-right py-1.5 font-semibold">Per portion ({data.portionWeightG}g)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(nutrientLabels).map(([key, label]) => (
                  <tr key={key} className="border-b border-border/50">
                    <td className={`py-1.5 ${label.startsWith("  ") ? "pl-4 text-muted-foreground text-xs" : "font-medium"}`}>{label.trim()}</td>
                    <td className="text-right py-1.5">{data.per100g[key] != null ? data.per100g[key] : "—"}{data.per100g[key] != null && (key.startsWith("energy") ? "" : "g")}</td>
                    <td className="text-right py-1.5">{data.perPortion[key] != null ? data.perPortion[key] : "—"}{data.perPortion[key] != null && (key.startsWith("energy") ? "" : "g")}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!data.completeness.isComplete && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-1">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Incomplete Data</p>
                {data.completeness.missingNutritionals.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">Missing nutritionals: {data.completeness.missingNutritionals.join(", ")}</p>
                )}
                {data.completeness.missingDeclarations.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">Missing label declarations: {data.completeness.missingDeclarations.join(", ")}</p>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecipeIngredientDeckDialog({ id, open, onOpenChange }: { id: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [data, setData] = useState<DeckData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch(`${BASE_URL}/api/recipes/${id}/ingredient-deck`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, id]);

  const copyDeck = () => {
    if (!data) return;
    const plain = data.deckText.replace(/\*\*/g, "");
    navigator.clipboard.writeText(plain);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] bg-card border-border rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2"><ClipboardList className="w-5 h-5" /> Ingredient Deck</DialogTitle>
        </DialogHeader>
        {loading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
        {error && <p className="text-destructive text-sm py-4">{error}</p>}
        {data && (
          <div className="space-y-4 mt-2">
            <div className="bg-secondary/20 rounded-lg p-4 border border-border">
              <p className="text-sm leading-relaxed" dangerouslySetInnerHTML={{
                __html: data.deckText.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
              }} />
              <button onClick={copyDeck} className="mt-2 text-xs text-primary hover:underline">Copy to clipboard</button>
            </div>

            {data.allergens.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-1">Allergens Present</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.allergens.map(a => (
                    <span key={a} className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">{a}</span>
                  ))}
                </div>
              </div>
            )}

            {data.mayContainStatement && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{data.mayContainStatement}</p>
              </div>
            )}

            <div>
              <p className="text-sm font-semibold mb-1">Breakdown by Weight</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1">Ingredient</th>
                    <th className="text-right py-1">%</th>
                    <th className="text-right py-1">Allergens</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ingredients.map((ing, idx) => (
                    <tr key={idx} className="border-b border-border/30">
                      <td className="py-1">{ing.name}</td>
                      <td className="text-right py-1 font-medium">{ing.percentage}%</td>
                      <td className="text-right py-1 text-xs">{ing.allergens.length > 0 ? ing.allergens.join(", ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!data.isComplete && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Missing Declarations</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">{data.missingDeclarations.join(", ")}</p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecipeCard({ recipe, onEdit, onDelete, onBreakdown, onDuplicate }: { recipe: RecipeItem; onEdit: () => void; onDelete: () => void; onBreakdown: () => void; onDuplicate: () => void }) {
  const margin = recipe.grossMargin;
  const recipeColor = (recipe as any).color as string | null;
  const [nutritionalsOpen, setNutritionalsOpen] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  const [kanbanCreating, setKanbanCreating] = useState(false);

  const borderStyle: React.CSSProperties = recipeColor
    ? { borderColor: recipeColor + "60" }
    : {};
  const topStyle: React.CSSProperties = recipeColor
    ? { backgroundColor: recipeColor + "14" }
    : {};
  const fallbackBorder = recipeColor ? "" : "border-border";
  const fallbackBg = recipeColor ? "" : "bg-secondary/10";

  return (
    <div className={`rounded-2xl border-2 ${fallbackBorder} bg-card overflow-hidden flex flex-col group hover:shadow-md transition-all`} style={borderStyle}>
      <div className={`${fallbackBg} flex flex-col justify-between px-5 pt-4 pb-3 gap-2`} style={topStyle}>
        <div className="min-w-0">
          <p className="font-semibold text-base leading-tight truncate" style={recipeColor ? { color: recipeColor } : undefined}>{recipe.name}</p>
          {recipe.category && <p className="text-xs font-semibold uppercase tracking-wider mt-0.5" style={recipeColor ? { color: recipeColor + "cc" } : { color: "var(--muted-foreground)" }}>{recipe.category}</p>}
        </div>
        <div className="flex items-center justify-end">
          <div className="flex items-center gap-1">
            <button onClick={() => setNutritionalsOpen(true)} className="w-7 h-7 rounded-full bg-background/90 backdrop-blur text-muted-foreground flex items-center justify-center hover:text-[#919b5f] transition-colors shadow-sm" title="Nutritionals"><Beaker className="w-3 h-3" /></button>
            <button onClick={() => setDeckOpen(true)} className="w-7 h-7 rounded-full bg-background/90 backdrop-blur text-muted-foreground flex items-center justify-center hover:text-[#919b5f] transition-colors shadow-sm" title="Ingredient Deck"><ClipboardList className="w-3 h-3" /></button>
            <button onClick={onBreakdown} className="w-7 h-7 rounded-full bg-background/90 backdrop-blur flex items-center justify-center hover:text-white transition-colors shadow-sm" style={recipeColor ? { color: recipeColor } : undefined} title="Cost Breakdown"><BarChart2 className="w-3 h-3" /></button>
            <button onClick={onEdit} className="w-7 h-7 rounded-full bg-background/90 backdrop-blur text-muted-foreground flex items-center justify-center hover:text-foreground transition-colors shadow-sm" title="Edit"><Edit2 className="w-3 h-3" /></button>
            <button onClick={onDuplicate} className="w-7 h-7 rounded-full bg-background/90 backdrop-blur text-muted-foreground flex items-center justify-center hover:text-foreground transition-colors shadow-sm" title="Duplicate"><Copy className="w-3 h-3" /></button>
            <button
              disabled={kanbanCreating}
              onClick={async () => {
                setKanbanCreating(true);
                try {
                  const res = await fetch(`/api/recipes/${recipe.id}/create-kanban`, { method: "POST", credentials: "include" });
                  if (res.status === 409) { alert("A kanban already exists for this recipe."); return; }
                  if (!res.ok) throw new Error("Failed");
                  alert("Kanban created with QR code!");
                } catch { alert("Failed to create kanban."); }
                finally { setKanbanCreating(false); }
              }}
              className="w-7 h-7 rounded-full bg-background/90 backdrop-blur text-muted-foreground flex items-center justify-center hover:text-primary transition-colors shadow-sm"
              title="Create Kanban"
            >
              {kanbanCreating ? <Loader2 className="w-3 h-3 animate-spin" /> : <QrCode className="w-3 h-3" />}
            </button>
            <button onClick={onDelete} className="w-7 h-7 rounded-full bg-background/90 backdrop-blur text-destructive flex items-center justify-center hover:bg-destructive hover:text-white transition-colors shadow-sm" title="Delete"><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>
      </div>

      <div className="p-4 flex flex-col flex-1 gap-3">
        {recipe.description && <p className="text-xs text-muted-foreground line-clamp-2">{recipe.description}</p>}

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

          <div className="pt-1 font-semibold" style={recipeColor ? { borderTopColor: recipeColor + "40", borderTopWidth: "1px" } : { borderTopColor: "var(--border)", borderTopWidth: "1px" }}>Total pack cost</div>
          <div className="pt-1 text-right font-bold" style={recipeColor ? { borderTopColor: recipeColor + "40", borderTopWidth: "1px", color: recipeColor } : { borderTopColor: "var(--border)", borderTopWidth: "1px" }}>£{fmt(recipe.totalPackCost)}</div>

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

        <div className="flex justify-end mt-auto pt-1">
          <MarginBadge margin={margin} />
        </div>
      </div>
      <RecipeNutritionalsDialog id={recipe.id} open={nutritionalsOpen} onOpenChange={setNutritionalsOpen} />
      <RecipeIngredientDeckDialog id={recipe.id} open={deckOpen} onOpenChange={setDeckOpen} />
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
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);
  const [duplicateDefaults, setDuplicateDefaults] = useState<FormValues | null>(null);

  const { data: duplicateDetail } = useGetRecipe(duplicatingId!, { query: { enabled: duplicatingId !== null } });

  useEffect(() => {
    if (duplicatingId !== null && duplicateDetail && duplicateDetail.id === duplicatingId) {
      const vals: FormValues = {
        name: `Copy of ${duplicateDetail.name}`,
        category: duplicateDetail.category ?? "",
        description: duplicateDetail.description ?? "",
        servings: Number(duplicateDetail.servings),
        servingUnit: duplicateDetail.servingUnit,
        notes: duplicateDetail.notes ?? "",
        packSize: Number(duplicateDetail.packSize) || 1,
        rrp: Number(duplicateDetail.rrp) || 0,
        packagingCost: Number(duplicateDetail.packagingCost) || 0,
        labourCost: Number(duplicateDetail.labourCost) || 0,
        portionsPerBatch: Number(duplicateDetail.portionsPerBatch) || 10,
        shelfLifeDays: duplicateDetail.shelfLifeDays != null ? Number(duplicateDetail.shelfLifeDays) : undefined,
        tinSize: duplicateDetail.tinSize ?? "",
        maxBatchesPerTin: duplicateDetail.maxBatchesPerTin != null ? Number(duplicateDetail.maxBatchesPerTin) : null,
        sopUrl: duplicateDetail.sopUrl ?? "",
        isCoreMenu: duplicateDetail.isCoreMenu ?? false,
        isCurrentSpecial: false,
        color: duplicateDetail.color ?? "",
        cookingLossPercent: (duplicateDetail as Record<string, unknown>).cookingLossPercent != null ? Number((duplicateDetail as Record<string, unknown>).cookingLossPercent) : 3,
        ingredients: (duplicateDetail.ingredients ?? []).map(i => ({ ingredientId: i.ingredientId, quantity: Number(i.quantity), marinadeForIngredientId: i.marinadeForIngredientId ?? null, includeInFillingMix: i.includeInFillingMix ?? false, isTopping: (i as Record<string, unknown>).isTopping === true })),
        subRecipes: (duplicateDetail.subRecipes ?? []).map(s => ({ subRecipeId: s.subRecipeId, quantity: Number(s.quantity), marinadeForIngredientId: s.marinadeForIngredientId ?? null, includeInFillingMix: s.includeInFillingMix ?? false, isTopping: (s as Record<string, unknown>).isTopping === true })),
      };
      setDuplicateDefaults(vals);
      setIsAddOpen(true);
      setDuplicatingId(null);
    }
  }, [duplicatingId, duplicateDetail]);

  const ingredientList: IngredientOption[] = (ingredients ?? []).map(i => ({
    id: i.id,
    name: i.name,
    unit: i.unit,
    processingRatio: Number(i.processingRatio) || 1,
    packWeight: Number(i.packWeight) || 0,
    costPerPack: Number(i.costPerPack) || 0,
    category: i.category ?? null,
  }));
  const subRecipeList: SubRecipeOption[] = (subRecipesData ?? []).map(s => ({
    id: s.id,
    name: s.name,
    yieldUnit: s.yieldUnit,
    costPerYieldUnit: Number(s.costPerYieldUnit) || 0,
  }));
  const catDefaults = (categoryDefaultsData ?? []).map(d => ({
    category: d.category,
    defaultPackagingCost: d.defaultPackagingCost,
    defaultLabourCost: d.defaultLabourCost,
  }));

  const addDefaults: FormValues = {
    name: "", category: "", description: "", servings: 1, servingUnit: "portion", notes: "",
    packSize: 1, rrp: 0, packagingCost: 0, labourCost: 0, portionsPerBatch: 10, shelfLifeDays: undefined,
    tinSize: "", maxBatchesPerTin: null, sopUrl: "", isCoreMenu: false, isCurrentSpecial: false, color: "", cookingLossPercent: 3, ingredients: [], subRecipes: [],
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
      <Dialog open={isAddOpen} onOpenChange={(v) => { setIsAddOpen(v); if (!v) setDuplicateDefaults(null); }}>
        <DialogContent className="sm:max-w-[720px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-xl">{duplicateDefaults ? "Duplicate Final Product" : "New Final Product"}</DialogTitle></DialogHeader>
          <RecipeForm
            key={duplicateDefaults ? "duplicate" : "new"}
            defaultValues={duplicateDefaults ?? addDefaults}
            isEdit={false}
            isPending={createRecipe.isPending}
            ingredients={ingredientList}
            subRecipes={subRecipeList}
            categoryDefaults={catDefaults}
            onSubmit={(data) => createRecipe.mutate({ data }, { onSuccess: () => { setIsAddOpen(false); setDuplicateDefaults(null); } })}
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
            onDuplicate={() => setDuplicatingId(recipe.id)}
          />
        ))}
      </div>
    </div>
  );
}
