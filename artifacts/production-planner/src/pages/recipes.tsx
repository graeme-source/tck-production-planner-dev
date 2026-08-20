import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useListRecipes, useListIngredients, useListSubRecipes, useGetRecipe, useListCategoryDefaults, useGetUpfSummary } from "@workspace/api-client-react";
import { UpfChip, UpfPercentPill } from "@/components/upf-badge";
import { useAppMutations } from "@/hooks/use-mutations";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { QuickAddIngredientDialog } from "@/components/quick-add-ingredient";
import { IngredientCombobox } from "@/components/ingredient-combobox";
import { Plus, Trash2, ChefHat, X, Edit2, Loader2, TrendingUp, Package, Wrench, ChevronDown, ChevronRight, BarChart2, Beaker, AlertTriangle, ClipboardList, Copy, Check, QrCode, Filter, Scale, LayoutGrid, Table2, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
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
  targetBuildMinutes: z.preprocess(
    v => (v === "" || v == null ? null : Number(v)),
    z.number().positive().max(60, "Max 60 minutes").nullable().optional()
  ),
  shelfLifeDays: z.coerce.number().int().nonnegative().optional(),
  tinSize: z.string().optional(),
  maxBatchesPerTin: z.preprocess(v => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable().optional()),
  sopUrl: z.string().optional(),
  isCoreMenu: z.boolean().optional(),
  isCurrentSpecial: z.boolean().optional(),
  // Saved via the dedicated /recipes/:id/fridge-product endpoint, not the
  // main create/update body (whose validator is OpenAPI-generated).
  isFridgeProduct: z.boolean().optional(),
  color: z.string().optional(),
  cookingLossPercent: z.preprocess(v => (v === "" || v == null ? null : Number(v)), z.number().min(0).max(50).nullable().optional()),
  builderFillingDeductionGrams: z.preprocess(v => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(500, "Max 500 g").optional()),
  dietaryCategory: z.preprocess(v => (v === "" ? null : v), z.enum(["meat", "vegetarian"]).nullable().optional()),
  tags: z.array(z.string()).optional(),
  ingredients: z.array(z.object({
    ingredientId: z.coerce.number().min(1, "Select ingredient"),
    quantity: z.coerce.number().min(0.001, "Must be > 0"),
    marinadeForIngredientId: z.preprocess(v => (v === "" || v === "0" || v == null ? null : Number(v)), z.number().nullable().optional()),
    marinadeAddAtCooking: z.boolean().optional(),
    includeInFillingMix: z.boolean().optional(),
    isTopping: z.boolean().optional(),
    quid: z.boolean().optional(),
    showInPrep: z.boolean().optional(),
    mixingOverage: z.preprocess(v => (v === "" || v == null ? 0 : Number(v)), z.number().min(0).optional()),
  })),
  subRecipes: z.array(z.object({
    subRecipeId: z.coerce.number().min(1, "Select sub-recipe"),
    quantity: z.coerce.number().min(0.001, "Must be > 0"),
    marinadeForIngredientId: z.preprocess(v => (v === "" || v === "0" || v == null ? null : Number(v)), z.number().nullable().optional()),
    marinadeAddAtCooking: z.boolean().optional(),
    includeInFillingMix: z.boolean().optional(),
    isTopping: z.boolean().optional(),
    quid: z.boolean().optional(),
    showInPrep: z.boolean().optional(),
    mixingOverage: z.preprocess(v => (v === "" || v == null ? 0 : Number(v)), z.number().min(0).optional()),
  })),
});

type FormValues = z.infer<typeof schema>;

function fmt(n: number | undefined | null) { return (Number(n) || 0).toFixed(2); }

// Display a per-recipe cooked/raw quantity. These amounts are tiny, so
// kilograms are shown as grams (0.01 kg → "10 g") for readability — fewer
// decimals as the number grows. Any other unit is shown as-is to 2dp.
function fmtQty(n: number | undefined | null, unit: string | undefined | null): string {
  const v = Number(n) || 0;
  if (unit === "kg") {
    const g = v * 1000;
    const decimals = g >= 10 ? 0 : g >= 1 ? 1 : 2;
    return `${g.toFixed(decimals)} g`;
  }
  return `${v.toFixed(2)} ${unit ?? ""}`.trim();
}

/** Chip-style tag editor used inside the recipe form. Suggestions
 *  come from the union of tags already used on other recipes so the
 *  operator doesn't end up with "GF" / "gluten-free" / "GLUTEN FREE"
 *  as three separate tags. Enter/comma to commit, backspace on an
 *  empty input deletes the last chip. */
function TagInput({ value, onChange, suggestions }: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
}) {
  const [draft, setDraft] = useState("");
  const lowerExisting = new Set(value.map(v => v.toLowerCase()));
  const addTag = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (lowerExisting.has(trimmed.toLowerCase())) { setDraft(""); return; }
    onChange([...value, trimmed]);
    setDraft("");
  };
  const removeTag = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const filteredSuggestions = draft.trim()
    ? suggestions.filter(s => !lowerExisting.has(s.toLowerCase()) && s.toLowerCase().includes(draft.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 items-center px-2 py-1.5 bg-background border border-border rounded-lg min-h-[40px] focus-within:ring-2 focus-within:ring-primary/30">
        {value.map((tag, i) => (
          <span key={`${tag}-${i}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
            {tag}
            <button type="button" onClick={() => removeTag(i)} className="hover:text-destructive">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(draft); }
            else if (e.key === "Backspace" && draft === "" && value.length > 0) { removeTag(value.length - 1); }
          }}
          onBlur={() => { if (draft.trim()) addTag(draft); }}
          placeholder={value.length === 0 ? "Type a tag and press Enter (e.g. gluten-free, summer, kids)" : ""}
          className="flex-1 min-w-[160px] bg-transparent text-sm focus:outline-none"
        />
      </div>
      {filteredSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {filteredSuggestions.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s)}
              className="px-2 py-0.5 rounded-full text-xs bg-secondary/60 text-muted-foreground hover:bg-secondary border border-border"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MarginBadge({ margin }: { margin: number | null | undefined }) {
  if (margin == null) return <span className="text-xs text-muted-foreground italic">No RRP set</span>;
  const label = `${margin.toFixed(1)}%`;
  if (margin >= 80) return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">
      <TrendingUp className="w-3 h-3" /> {label}
    </span>
  );
  if (margin >= 75) return (
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
  const color = margin >= 80 ? "bg-green-500" : margin >= 75 ? "bg-amber-400" : "bg-red-500";
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
  supplierName?: string | null;
  novaClass?: number | null;
  novaMarkers?: string[];
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
  currentSpecialName,
  thisRecipeIsSpecial,
  onDirtyChange,
  submitRef,
  allTags,
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
  allTags?: string[];
}) {
  const { register, control, handleSubmit, setValue, watch, formState: { errors, isDirty } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  // Only admins and managers can edit per-recipe build time targets; everyone
  // else sees the field disabled. The target drives the countdown timer inside
  // the BATCH BUILT button on the building station.
  const { state: recipeFormAuthState } = useAuth();
  const canEditBuildTime =
    recipeFormAuthState.status === "authenticated" &&
    (recipeFormAuthState.user.role === "admin" || recipeFormAuthState.user.role === "manager");

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
  // Sub-recipe UPF % lookup for the per-row chip in the Sub Recipes section.
  const { data: formUpfSummary } = useGetUpfSummary();
  const formSubUpfById = useMemo(
    () => new Map((formUpfSummary?.subRecipes ?? []).map(s => [s.subRecipeId, s])),
    [formUpfSummary],
  );
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
  const watchedCookingLoss = watch("cookingLossPercent");
  const watchedPackSize = watch("packSize");

  // Live declared-weight calculator — runs on every keystroke so the user
  // sees portion and pack weight update like a spreadsheet as they edit
  // ingredients, sub-recipes, cooking-loss %, recipe size, or pack size.
  // Quantities are stored in the ingredient's native unit (kg or g);
  // we normalise to grams here.
  //
  // Divisor is `servings` (the recipe's "Output / Recipe Size"), NOT
  // portionsPerBatch. Ingredient quantities in the form are entered for
  // whatever amount the recipe produces — typically 1 portion. portionsPerBatch
  // is a separate production-batching number (how many portions get made in
  // one cook) and has no bearing on the per-portion weight.
  const liveWeights = useMemo(() => {
    let rawG = 0;
    for (const row of watchedIngredients ?? []) {
      if (!row) continue;
      const ing = localIngredients.find(i => i.id === Number(row.ingredientId));
      if (!ing) continue;
      const qty = Number(row.quantity) || 0;
      rawG += ing.unit === "kg" ? qty * 1000 : qty;
    }
    for (const row of watchedSubRecipes ?? []) {
      if (!row) continue;
      const sub = subRecipes.find(s => s.id === Number(row.subRecipeId));
      if (!sub) continue;
      const qty = Number(row.quantity) || 0;
      rawG += sub.yieldUnit === "kg" ? qty * 1000 : qty;
    }
    const lossPct = Math.max(0, Math.min(50, Number(watchedCookingLoss ?? 3) || 0));
    const cookedG = rawG * (1 - lossPct / 100);
    const recipeServings = Math.max(0.0001, Number(watchedServings) || 1);
    const portionG = cookedG / recipeServings;
    const ps = Math.max(1, Number(watchedPackSize) || 1);
    const packG = portionG * ps;
    return { rawG, cookedG, portionG, packG, lossPct, servings: recipeServings, ps };
  }, [watchedIngredients, watchedSubRecipes, watchedCookingLoss, watchedServings, watchedPackSize, localIngredients, subRecipes]);

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const cat = e.target.value;
    if (cat === "__add_new__") {
      setAddingCategory(true);
      return;
    }
    setValue("category", cat);
    const def = categoryDefaults.find(d => d.category.toLowerCase() === cat.toLowerCase());
    if (def) {
      setValue("packSize", (def as Record<string, unknown>).defaultPackSize as number ?? 1);
      setValue("packagingCost", def.defaultPackagingCost);
      setValue("labourCost", def.defaultLabourCost);
    }
  };

  const handleAddCategory = () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    setValue("category", trimmed);
    setAddingCategory(false);
    setNewCategoryName("");
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
            {addingCategory ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddCategory(); } }}
                  placeholder="New category name…"
                  className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  autoFocus
                />
                <button type="button" onClick={handleAddCategory} className="px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium">Add</button>
                <button type="button" onClick={() => setAddingCategory(false)} className="px-3 py-2 border border-border rounded-lg text-sm">Cancel</button>
              </div>
            ) : (
              <select
                {...register("category")}
                onChange={handleCategoryChange}
                value={watchedCategory ?? ""}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">Select category…</option>
                {categoryDefaults.map(d => <option key={d.category} value={d.category}>{d.category}</option>)}
                {/* Show current value if it's not in categoryDefaults (e.g. already saved on recipe) */}
                {watchedCategory && !categoryDefaults.find(d => d.category === watchedCategory) && (
                  <option value={watchedCategory}>{watchedCategory}</option>
                )}
                <option value="__add_new__">+ Add new category…</option>
              </select>
            )}
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
            <label className="text-sm font-medium mb-1 block">Target build time (minutes)</label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="60"
              {...register("targetBuildMinutes")}
              disabled={!canEditBuildTime}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder="e.g. 6 (blank = use default)"
            />
            <p className="text-xs text-muted-foreground mt-0.5">
              {canEditBuildTime
                ? "Countdown timer inside the BATCH BUILT button. Blank = use global default."
                : "Admin/manager only"}
            </p>
            {errors.targetBuildMinutes && <span className="text-destructive text-xs">{errors.targetBuildMinutes.message}</span>}
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
            <label className="text-sm font-medium mb-1 block">Builder Filling Trim (g)</label>
            <input type="number" step="1" min="0" max="500" {...register("builderFillingDeductionGrams")} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="0" />
            <p className="text-xs text-muted-foreground mt-0.5">Grams off the filling weight the builders see, per batch. Display only — prep, costing and the printed plan are unchanged.</p>
            {errors.builderFillingDeductionGrams && <span className="text-destructive text-xs">{String(errors.builderFillingDeductionGrams.message)}</span>}
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
          <div className="col-span-2 flex items-end gap-3">
            <div className="flex-1 max-w-xs">
              <label className="text-sm font-medium mb-1 block">Dietary category</label>
              <select
                {...register("dietaryCategory")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">— not set —</option>
                <option value="meat">Meat</option>
                <option value="vegetarian">Vegetarian</option>
              </select>
              <span className="text-xs text-muted-foreground mt-1 block">Drives the oven-defaults overlay shown on the first batch built.</span>
            </div>
          </div>
          <div className="col-span-2 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="isCoreMenu" {...register("isCoreMenu")} className="rounded border-border" />
              <label htmlFor="isCoreMenu" className="text-sm font-medium">Core Menu Item</label>
              <span className="text-xs text-muted-foreground">(always shows in Production Fridge stock &amp; calculator)</span>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="isFridgeProduct" {...register("isFridgeProduct")} className="rounded border-border" />
              <label htmlFor="isFridgeProduct" className="text-sm font-medium">Fridge Product</label>
              <span className="text-xs text-muted-foreground">(wrapped into the production fridge — test calzones etc.; sales appear as chilled-dispatch suggestions on Create Plan. Not for frozen / F2F / clearance lines)</span>
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
          <div className="col-span-2">
            <label className="text-sm font-medium mb-1 block">Tags</label>
            <Controller
              control={control}
              name="tags"
              render={({ field }) => (
                <TagInput
                  value={field.value ?? []}
                  onChange={(next) => field.onChange(next)}
                  suggestions={allTags ?? []}
                />
              )}
            />
            <span className="text-xs text-muted-foreground mt-1 block">Free-form labels — drives the search bar &amp; tag filter on the recipes list.</span>
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

        {/* Declared Weights — live spreadsheet-style calculation. Sums every
            ingredient + sub-recipe in grams, applies the recipe's cooking-loss
            %, then divides by portions-per-batch and multiplies by pack size.
            Updates instantly while editing the recipe so the label weight is
            visible without saving. */}
        <div className="bg-emerald-50/40 dark:bg-emerald-950/10 rounded-xl p-4 space-y-2 border border-emerald-200/60 dark:border-emerald-900/40">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="text-sm font-semibold flex items-center gap-2 text-emerald-900 dark:text-emerald-200">
              <Scale className="w-4 h-4" /> Declared Weights
              <span className="text-xs font-normal text-emerald-700/70 dark:text-emerald-300/70">live · for labelling</span>
            </h4>
            <span className="text-[11px] text-muted-foreground">
              {((watchedIngredients?.length ?? 0))} ingredient{(watchedIngredients?.length ?? 0) !== 1 ? "s" : ""}
              {(watchedSubRecipes?.length ?? 0) > 0 ? ` + ${watchedSubRecipes?.length} sub-recipe${(watchedSubRecipes?.length ?? 0) !== 1 ? "s" : ""}` : ""}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <div className="bg-card/60 rounded-lg p-2.5 border border-border/50">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Total raw</p>
              <p className="font-bold tabular-nums text-base mt-0.5">{liveWeights.rawG > 0 ? `${Math.round(liveWeights.rawG)} g` : "—"}</p>
              <p className="text-[10px] text-muted-foreground">Sum of ingredients</p>
            </div>
            <div className="bg-card/60 rounded-lg p-2.5 border border-border/50">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">After cooking</p>
              <p className="font-bold tabular-nums text-base mt-0.5">{liveWeights.cookedG > 0 ? `${Math.round(liveWeights.cookedG)} g` : "—"}</p>
              <p className="text-[10px] text-muted-foreground">−{liveWeights.lossPct}% loss</p>
            </div>
            <div className="bg-emerald-100/70 dark:bg-emerald-900/30 rounded-lg p-2.5 border border-emerald-300/70 dark:border-emerald-700/60">
              <p className="text-[10px] uppercase tracking-wide text-emerald-800 dark:text-emerald-300 font-semibold">Portion weight</p>
              <p className="font-bold tabular-nums text-base mt-0.5 text-emerald-900 dark:text-emerald-100">{liveWeights.portionG > 0 ? `${Math.round(liveWeights.portionG)} g` : "—"}</p>
              <p className="text-[10px] text-emerald-800/70 dark:text-emerald-300/70">{liveWeights.servings === 1 ? "1 portion recipe" : `÷ ${liveWeights.servings} portions`}</p>
            </div>
            <div className="bg-emerald-100/70 dark:bg-emerald-900/30 rounded-lg p-2.5 border border-emerald-300/70 dark:border-emerald-700/60">
              <p className="text-[10px] uppercase tracking-wide text-emerald-800 dark:text-emerald-300 font-semibold">Pack weight</p>
              <p className="font-bold tabular-nums text-base mt-0.5 text-emerald-900 dark:text-emerald-100">{liveWeights.packG > 0 ? `${Math.round(liveWeights.packG)} g` : "—"}</p>
              <p className="text-[10px] text-emerald-800/70 dark:text-emerald-300/70">× {liveWeights.ps} portion{liveWeights.ps !== 1 ? "s" : ""}/pack</p>
            </div>
          </div>
          {liveWeights.rawG === 0 && (
            <p className="text-[11px] text-muted-foreground italic">Add ingredients below to see the declared weights.</p>
          )}
        </div>

        {/* Unified Ingredients & Prep Items */}
        {(() => {
          // All ingredients in this recipe that can be linked to (for connected ingredient pairs)
          const linkableIngs = (watchedIngredients ?? [])
            .map(wi => localIngredients.find(i => i.id === Number(wi.ingredientId)))
            .filter((i): i is IngredientOption => !!i);

          return (
            <div className="border-t border-border pt-4 space-y-0">
              {/* Column headers */}
              <div className="grid grid-cols-[1fr_8rem_6rem_3.5rem_2rem_2rem_2rem_4rem_1.25rem] gap-x-2 gap-y-0 items-end px-1 mb-1.5">
                <span className="text-[10px] text-muted-foreground font-medium">Name</span>
                <span className="text-[10px] text-muted-foreground font-medium">Supplier</span>
                <span className="text-[10px] text-muted-foreground font-medium">Qty</span>
                <span className="text-[10px] text-muted-foreground font-medium text-right">Cost</span>
                <span className="text-[10px] text-muted-foreground font-medium text-center" title="Include in filling mix">Fill</span>
                <span className="text-[10px] text-muted-foreground font-medium text-center" title="Topping — skips prep">Top</span>
                <span className="text-[10px] text-muted-foreground font-medium text-center" title="Show in prep station (for filling items)">Prep</span>
                <span className="text-[10px] text-amber-600 font-medium text-center" title="Extra grams added at mixing station only">Mix +g</span>
                <span />
              </div>

              {/* Ingredients section */}
              <div className="mb-1">
                <div className="py-1.5">
                  <span className="text-xs font-semibold text-primary uppercase tracking-wide">
                    Ingredients <span className="font-normal normal-case text-muted-foreground tracking-normal">(cooked qty)</span>
                  </span>
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
                        <div className="grid grid-cols-[1fr_8rem_6rem_3.5rem_2rem_2rem_2rem_4rem_1.25rem] gap-x-2 gap-y-0 items-center">
                          <Controller
                            control={control}
                            name={`ingredients.${index}.ingredientId`}
                            render={({ field }) => (
                              <IngredientCombobox
                                value={Number(field.value)}
                                onChange={id => field.onChange(id)}
                                options={localIngredients}
                                onCreateNew={() => openQuickAdd(index)}
                              />
                            )}
                          />
                          <span className="text-[11px] text-muted-foreground truncate inline-flex items-center gap-1" title={thisIng?.supplierName ?? undefined}>
                            <UpfChip novaClass={thisIng?.novaClass} markers={thisIng?.novaMarkers} />
                            <span className="truncate">{thisIng?.supplierName ?? <span className="text-muted-foreground/40">—</span>}</span>
                          </span>
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
                          <div className="flex justify-center">
                            <input type="checkbox" {...register(`ingredients.${index}.includeInFillingMix`)} className="rounded border-border text-primary focus:ring-primary/30 w-3.5 h-3.5 cursor-pointer" title="Include in filling mix" />
                          </div>
                          <div className="flex justify-center">
                            <input type="checkbox" {...register(`ingredients.${index}.isTopping`)} className="rounded border-border text-amber-500 focus:ring-amber-500/30 w-3.5 h-3.5 cursor-pointer" title="Topping" />
                          </div>
                          <div className="flex justify-center">
                            <input type="checkbox" {...register(`ingredients.${index}.showInPrep`)} className="rounded border-border text-emerald-500 focus:ring-emerald-500/30 w-3.5 h-3.5 cursor-pointer" title="Show in prep station" />
                          </div>
                          <div className="flex justify-center">
                            {watch(`ingredients.${index}.includeInFillingMix`) ? (() => {
                              const isKg = thisIng?.unit === "kg";
                              const storedOverage = Number(watchedIngredients?.[index]?.mixingOverage) || 0;
                              const displayGrams = isKg ? Math.round(storedOverage * 1000) : storedOverage;
                              return (
                                <div className="flex items-center gap-0.5">
                                  <input
                                    type="number"
                                    step="1"
                                    min="0"
                                    placeholder="0"
                                    value={displayGrams || ""}
                                    onChange={e => {
                                      const g = Number(e.target.value) || 0;
                                      setValue(`ingredients.${index}.mixingOverage`, isKg ? g / 1000 : g, { shouldDirty: true, shouldValidate: true });
                                    }}
                                    className="w-11 h-6 rounded border border-amber-300 bg-amber-50/50 dark:bg-amber-900/10 px-1 text-[10px] tabular-nums text-center focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                                  />
                                  <span className="text-[9px] text-amber-600">g</span>
                                </div>
                              );
                            })() : <span className="text-[10px] text-muted-foreground/30">—</span>}
                          </div>
                          <button type="button" onClick={() => removeIng(index)} className="text-muted-foreground hover:text-destructive flex justify-center"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        {(() => {
                          // Other ingredients this one can be linked to (exclude self)
                          const targets = linkableIngs.filter(i => i.id !== Number(watchedIngredients?.[index]?.ingredientId));
                          if (targets.length === 0) return null;
                          return ingMarinadeSet ? (
                            <div className="pl-1 flex items-center gap-1.5">
                              <select
                                {...register(`ingredients.${index}.marinadeForIngredientId`)}
                                className="px-1.5 py-0.5 bg-muted/50 border border-border rounded text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                              >
                                <option value="">Not linked</option>
                                {targets.map(m => <option key={m.id} value={m.id}>Linked to {m.name}</option>)}
                              </select>
                              <button type="button" onClick={() => setValue(`ingredients.${index}.marinadeForIngredientId`, null)} className="text-muted-foreground/60 hover:text-muted-foreground"><X className="w-3 h-3" /></button>
                              {/* Held back from prep day — the mixing/cooking station
                                  adds it on production day (e.g. Philly beef stock).
                                  Weight still counts toward the raw-meat tray sizing. */}
                              <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer" title="Don't add at raw meat prep — the mixing station adds this at cooking on production day. Still counted in tray sizing.">
                                <input type="checkbox" {...register(`ingredients.${index}.marinadeAddAtCooking`)} className="w-3 h-3 accent-primary" />
                                at cooking
                              </label>
                            </div>
                          ) : (
                            <button type="button" onClick={() => { setValue(`ingredients.${index}.marinadeForIngredientId`, targets[0]?.id ?? 0); }} className="pl-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                              + Link ingredient
                            </button>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => appendIng({ ingredientId: 0, quantity: 0, marinadeForIngredientId: null, marinadeAddAtCooking: false, includeInFillingMix: false, isTopping: false, showInPrep: false, mixingOverage: 0 })}
                  className="mt-1.5 w-full px-2 py-1.5 rounded-lg border border-dashed border-primary/40 text-primary hover:bg-primary/10 transition-colors text-xs font-medium"
                >
                  + Add ingredient to recipe
                </button>
              </div>

              {/* Divider */}
              <div className="border-t border-dashed border-border/60 my-2" />

              {/* Sub-recipes section */}
              <div>
                <div className="py-1.5">
                  <span className="text-xs font-semibold text-accent uppercase tracking-wide">Sub Recipes</span>
                </div>
                {subFields.length === 0 && <p className="text-xs text-muted-foreground italic pl-1 pb-1">No sub recipes added</p>}
                <div className="space-y-1.5">
                  {subFields.map((field, index) => {
                    const cost = subLineCost(index);
                    const subMarinadeVal = watchedSubRecipes?.[index]?.marinadeForIngredientId;
                    const subMarinadeSet = subMarinadeVal != null && subMarinadeVal !== "" && subMarinadeVal !== 0 && subMarinadeVal !== "0";
                    return (
                      <div key={field.id} className="space-y-0.5">
                        <div className="grid grid-cols-[1fr_8rem_6rem_3.5rem_2rem_2rem_2rem_4rem_1.25rem] gap-x-2 gap-y-0 items-center">
                          <select {...register(`subRecipes.${index}.subRecipeId`)} className="min-w-0 px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30">
                            <option value={0} disabled>Select…</option>
                            {subRecipes.map(s => <option key={s.id} value={s.id}>{s.name} ({s.yieldUnit})</option>)}
                          </select>
                          {(() => {
                            const subUpf = formSubUpfById.get(Number(watchedSubRecipes?.[index]?.subRecipeId));
                            return subUpf != null && (subUpf.upfPercent ?? 0) > 0 ? (
                              <UpfPercentPill
                                percent={subUpf.upfPercent}
                                unclassifiedCount={subUpf.unclassifiedIngredients.length}
                                upfNames={subUpf.upfIngredients.map(u => u.name)}
                              />
                            ) : <span className="text-[11px] text-muted-foreground/40">—</span>;
                          })()}
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
                          <div className="flex justify-center">
                            <input type="checkbox" {...register(`subRecipes.${index}.includeInFillingMix`)} className="rounded border-border text-primary focus:ring-primary/30 w-3.5 h-3.5 cursor-pointer" title="Include in filling mix" />
                          </div>
                          <div className="flex justify-center">
                            <input type="checkbox" {...register(`subRecipes.${index}.isTopping`)} className="rounded border-border text-amber-500 focus:ring-amber-500/30 w-3.5 h-3.5 cursor-pointer" title="Topping" />
                          </div>
                          <div className="flex justify-center">
                            <input type="checkbox" {...register(`subRecipes.${index}.showInPrep`)} className="rounded border-border text-emerald-500 focus:ring-emerald-500/30 w-3.5 h-3.5 cursor-pointer" title="Show in prep station" />
                          </div>
                          <div className="flex justify-center">
                            {watch(`subRecipes.${index}.includeInFillingMix`) ? (() => {
                              const thisSub = subRecipes.find(s => s.id === Number(watchedSubRecipes?.[index]?.subRecipeId));
                              const isKg = thisSub?.yieldUnit === "kg";
                              const storedOverage = Number(watchedSubRecipes?.[index]?.mixingOverage) || 0;
                              const displayGrams = isKg ? Math.round(storedOverage * 1000) : storedOverage;
                              return (
                                <div className="flex items-center gap-0.5">
                                  <input
                                    type="number"
                                    step="1"
                                    min="0"
                                    placeholder="0"
                                    value={displayGrams || ""}
                                    onChange={e => {
                                      const g = Number(e.target.value) || 0;
                                      setValue(`subRecipes.${index}.mixingOverage`, isKg ? g / 1000 : g, { shouldDirty: true, shouldValidate: true });
                                    }}
                                    className="w-11 h-6 rounded border border-amber-300 bg-amber-50/50 dark:bg-amber-900/10 px-1 text-[10px] tabular-nums text-center focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                                  />
                                  <span className="text-[9px] text-amber-600">g</span>
                                </div>
                              );
                            })() : <span className="text-[10px] text-muted-foreground/30">—</span>}
                          </div>
                          <button type="button" onClick={() => removeSub(index)} className="text-muted-foreground hover:text-destructive flex justify-center"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        {linkableIngs.length > 0 && (
                          subMarinadeSet ? (
                            <div className="pl-1 flex items-center gap-1.5">
                              <select
                                {...register(`subRecipes.${index}.marinadeForIngredientId`)}
                                className="px-1.5 py-0.5 bg-muted/50 border border-border rounded text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                              >
                                <option value="">Not linked</option>
                                {linkableIngs.map(m => <option key={m.id} value={m.id}>Linked to {m.name}</option>)}
                              </select>
                              <button type="button" onClick={() => setValue(`subRecipes.${index}.marinadeForIngredientId`, null)} className="text-muted-foreground/60 hover:text-muted-foreground"><X className="w-3 h-3" /></button>
                              <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer" title="Don't add at raw meat prep — the mixing station adds this at cooking on production day. Still counted in tray sizing.">
                                <input type="checkbox" {...register(`subRecipes.${index}.marinadeAddAtCooking`)} className="w-3 h-3 accent-primary" />
                                at cooking
                              </label>
                            </div>
                          ) : (
                            <button type="button" onClick={() => { setValue(`subRecipes.${index}.marinadeForIngredientId`, linkableIngs[0]?.id ?? 0); }} className="pl-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                              + Link ingredient
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => appendSub({ subRecipeId: 0, quantity: 0, marinadeForIngredientId: null, marinadeAddAtCooking: false, includeInFillingMix: false, isTopping: false, showInPrep: false, mixingOverage: 0 })}
                  className="mt-1.5 w-full px-2 py-1.5 rounded-lg border border-dashed border-accent/40 text-accent hover:bg-accent/10 transition-colors text-xs font-medium"
                >
                  + Add sub-recipe to recipe
                </button>
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
  id?: number;
  shopify_variant_id: string;
  shopify_product_title: string | null;
  shopify_variant_title: string | null;
  wonky_variant_id: string | null;
  wonky_product_title: string | null;
  wonky_variant_title: string | null;
}

function EditRecipeDialog({
  id, open, onOpenChange, ingredients, subRecipes, categoryDefaults, allTags,
}: {
  id: number; open: boolean; onOpenChange: (v: boolean) => void;
  ingredients: IngredientOption[];
  subRecipes: SubRecipeOption[];
  categoryDefaults: { category: string; defaultPackagingCost: number; defaultLabourCost: number }[];
  allTags?: string[];
}) {
  const { state: authState } = useAuth();
  const canEditShopify = authState.status === "authenticated" &&
    (authState.user.role === "admin" || authState.user.role === "manager");

  const queryClient = useQueryClient();
  const { data: detail, isLoading, isFetching } = useGetRecipe(id, { query: { enabled: open } });
  const { data: allRecipes } = useListRecipes({ query: { enabled: open } });
  const { updateRecipe } = useAppMutations();

  const [formIsDirty, setFormIsDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const submitRef = useRef<(() => void) | null>(null);

  // Shopify link state — multiple variants per recipe
  const [shopifyMappings, setShopifyMappings] = useState<ShopifyMapping[]>([]);
  const [shopifyVariants, setShopifyVariants] = useState<ShopifyVariantOption[]>([]);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyProductsLoading, setShopifyProductsLoading] = useState(false);
  const [shopifySaving, setShopifySaving] = useState(false);
  const [shopifySearch, setShopifySearch] = useState("");
  const [selectedVariant, setSelectedVariant] = useState<ShopifyVariantOption | null>(null);
  const [shopifyError, setShopifyError] = useState<string | null>(null);
  const [shopifyAdding, setShopifyAdding] = useState(false);
  const [shopifyEditing, setShopifyEditing] = useState(false);

  // Label LIVE design mapping — which pinned design prints this recipe's
  // ingredient-deck label. Saved separately from the main form (like the
  // Shopify mapping) so it never interacts with form dirty-state.
  const [labelDesign, setLabelDesign] = useState("");
  const [labelDesignSaved, setLabelDesignSaved] = useState("");
  const [labelDesignSaving, setLabelDesignSaving] = useState(false);
  useEffect(() => {
    const v = (detail as Record<string, unknown> | undefined)?.labelLiveDesignName;
    const s = typeof v === "string" ? v : "";
    setLabelDesign(s);
    setLabelDesignSaved(s);
  }, [detail]);
  async function saveLabelDesign() {
    setLabelDesignSaving(true);
    try {
      const res = await fetch(`/api/recipes/${id}/label-design`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designName: labelDesign.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      const row = await res.json() as { labelLiveDesignName: string | null };
      setLabelDesignSaved(row.labelLiveDesignName ?? "");
      setLabelDesign(row.labelLiveDesignName ?? "");
      queryClient.invalidateQueries({ queryKey: [`/api/recipes/${id}`] });
    } catch {
      // leave the field as typed; the Save button stays visible for retry
    } finally {
      setLabelDesignSaving(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    // Load current mappings (now returns array)
    setShopifyLoading(true);
    fetch(`/api/recipes/${id}/shopify-mapping`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((data: ShopifyMapping[] | ShopifyMapping | null) => {
        // Handle both array (new) and single object (legacy) responses
        if (Array.isArray(data)) setShopifyMappings(data);
        else if (data) setShopifyMappings([data]);
        else setShopifyMappings([]);
      })
      .catch(() => setShopifyMappings([]))
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

  async function addShopifyMapping() {
    if (!selectedVariant) return;
    setShopifySaving(true);
    setShopifyError(null);
    try {
      const res = await fetch(`/api/recipes/${id}/shopify-mapping`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopifyVariantId: selectedVariant.variantId,
          shopifyProductTitle: selectedVariant.productTitle,
          shopifyVariantTitle: selectedVariant.variantTitle,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      const saved = await res.json() as ShopifyMapping[];
      setShopifyMappings(Array.isArray(saved) ? saved : [saved]);
      setSelectedVariant(null);
      setShopifySearch("");
      setShopifyAdding(false);
    } catch (err) {
      setShopifyError(err instanceof Error ? err.message : "Failed to save mapping");
    } finally {
      setShopifySaving(false);
    }
  }

  async function removeShopifyVariant(variantId: string) {
    setShopifySaving(true);
    setShopifyError(null);
    try {
      await fetch(`/api/recipes/${id}/shopify-mapping/${variantId}`, { method: "DELETE", credentials: "include" });
      setShopifyMappings(prev => prev.filter(m => m.shopify_variant_id !== variantId));
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
        targetBuildMinutes: (detail as Record<string, unknown>).targetBuildSeconds != null
          ? Number((detail as Record<string, unknown>).targetBuildSeconds) / 60
          : null,
        shelfLifeDays: detail.shelfLifeDays != null ? Number(detail.shelfLifeDays) : undefined,
        tinSize: detail.tinSize ?? "",
        maxBatchesPerTin: detail.maxBatchesPerTin != null ? Number(detail.maxBatchesPerTin) : null,
        sopUrl: detail.sopUrl ?? "",
        isCoreMenu: detail.isCoreMenu ?? false,
        isCurrentSpecial: detail.isCurrentSpecial ?? false,
        isFridgeProduct: (detail as Record<string, unknown>).isFridgeProduct === true,
        color: detail.color ?? "",
        cookingLossPercent: (detail as Record<string, unknown>).cookingLossPercent != null ? Number((detail as Record<string, unknown>).cookingLossPercent) : 3,
        builderFillingDeductionGrams: Number(detail.builderFillingDeductionGrams ?? 0),
        dietaryCategory: ((detail as Record<string, unknown>).dietaryCategory as "meat" | "vegetarian" | null | undefined) ?? null,
        tags: Array.isArray((detail as Record<string, unknown>).tags) ? ((detail as Record<string, unknown>).tags as string[]) : [],
        ingredients: (detail.ingredients ?? []).map(i => ({ ingredientId: i.ingredientId, quantity: Number(i.quantity), marinadeForIngredientId: i.marinadeForIngredientId ?? null, marinadeAddAtCooking: (i as { marinadeAddAtCooking?: boolean | null }).marinadeAddAtCooking === true, includeInFillingMix: i.includeInFillingMix ?? false, isTopping: (i as Record<string, unknown>).isTopping === true, quid: (i as Record<string, unknown>).quid === true, showInPrep: (i as Record<string, unknown>).showInPrep === true, mixingOverage: Number((i as Record<string, unknown>).mixingOverage ?? 0) })),
        subRecipes: (detail.subRecipes ?? []).map(s => ({ subRecipeId: s.subRecipeId, quantity: Number(s.quantity), marinadeForIngredientId: s.marinadeForIngredientId ?? null, marinadeAddAtCooking: (s as { marinadeAddAtCooking?: boolean | null }).marinadeAddAtCooking === true, includeInFillingMix: s.includeInFillingMix ?? false, isTopping: (s as Record<string, unknown>).isTopping === true, quid: (s as Record<string, unknown>).quid === true, showInPrep: (s as Record<string, unknown>).showInPrep === true, mixingOverage: Number((s as Record<string, unknown>).mixingOverage ?? 0) })),
      }
    : { name: "", category: "", description: "", servings: 1, servingUnit: "portion", notes: "", packSize: 1, rrp: 0, packagingCost: 0, labourCost: 0, portionsPerBatch: 10, targetBuildMinutes: null, shelfLifeDays: undefined, tinSize: "", maxBatchesPerTin: null, sopUrl: "", isCoreMenu: false, isCurrentSpecial: false, isFridgeProduct: false, color: "", cookingLossPercent: 3, builderFillingDeductionGrams: 0, dietaryCategory: null, tags: [], ingredients: [], subRecipes: [] };

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
        <DialogContent className="sm:max-w-[min(96vw,1100px)] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-xl">Edit Recipe</DialogTitle></DialogHeader>
          {(isLoading || isFetching) ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <RecipeForm
                key={`${id}-${detail?.ingredients?.length}`}
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
                allTags={allTags}
                onSubmit={(data) => {
                  // isFridgeProduct rides its own endpoint — the main update
                  // body's validator is OpenAPI-generated and would drop it.
                  const { targetBuildMinutes, isFridgeProduct, ...rest } = data;
                  const payload = {
                    ...rest,
                    targetBuildSeconds: targetBuildMinutes != null ? Math.round(targetBuildMinutes * 60) : null,
                  } as unknown as typeof data;
                  const fridgeWrite = fetch(`/api/recipes/${id}/fridge-product`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ isFridgeProduct: isFridgeProduct === true }),
                  }).catch(() => {});
                  updateRecipe.mutate({ id, data: payload }, { onSuccess: () => { fridgeWrite.finally(() => { queryClient.invalidateQueries({ queryKey: [`/api/recipes/${id}`] }); queryClient.invalidateQueries({ queryKey: ["/api/recipes"] }); }); onOpenChange(false); } });
                }}
              />

              {/* Shopify Inventory Link */}
              <div className="mt-4 border-t border-border pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-4 h-4 text-[#96bf48]" viewBox="0 0 24 24" fill="currentColor"><path d="M20.924 7.625a1.523 1.523 0 0 0-1.238-1.044l-1.822-.187-.88-2.062A1.5 1.5 0 0 0 15.6 3.5H8.4a1.5 1.5 0 0 0-1.384.832l-.88 2.062-1.822.187A1.523 1.523 0 0 0 3.076 7.625L2 17.5A1.5 1.5 0 0 0 3.5 19h17a1.5 1.5 0 0 0 1.5-1.5zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>
                  <h4 className="text-sm font-semibold">Shopify Inventory Link</h4>
                  {shopifyLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                </div>

                {/* Mapped variants list */}
                {shopifyMappings.length > 0 && (
                  <div className="space-y-1.5">
                    {shopifyMappings.map(m => (
                      <div key={m.shopify_variant_id} className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {m.shopify_product_title ?? "Shopify product"}
                            {m.shopify_variant_title && (
                              <span className="text-emerald-700 dark:text-emerald-300 font-normal"> – {m.shopify_variant_title}</span>
                            )}
                          </p>
                        </div>
                        {canEditShopify && (
                          <button
                            type="button"
                            onClick={() => removeShopifyVariant(m.shopify_variant_id)}
                            disabled={shopifySaving}
                            className="text-xs text-destructive hover:text-destructive/80 flex-shrink-0 disabled:opacity-50"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Add variant picker */}
                {canEditShopify && (
                  shopifyAdding ? (
                    <div className="space-y-2 mt-2">
                      {shopifyProductsLoading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                          <Loader2 className="w-3 h-3 animate-spin" /> Loading Shopify products…
                        </div>
                      ) : (
                        <>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="Search Shopify products…"
                              value={shopifySearch}
                              onChange={e => setShopifySearch(e.target.value)}
                              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                              autoFocus
                            />
                            {shopifySearch && (
                              <div className="absolute top-full left-0 right-0 z-10 bg-card border border-border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                                {shopifyVariants
                                  .filter(v => v.display.toLowerCase().includes(shopifySearch.toLowerCase()))
                                  .filter(v => !shopifyMappings.some(m => m.shopify_variant_id === v.variantId))
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
                              </div>
                            )}
                          </div>
                          {selectedVariant && (
                            <div className="flex items-center gap-2 p-2 bg-secondary/30 rounded-lg text-sm">
                              <span className="flex-1 font-medium truncate">{selectedVariant.display}</span>
                              <button type="button" onClick={() => setSelectedVariant(null)} className="text-muted-foreground hover:text-foreground">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={addShopifyMapping}
                              disabled={!selectedVariant || shopifySaving}
                              className="flex-1 py-1.5 px-3 rounded-lg bg-[#96bf48] text-white text-xs font-medium hover:bg-[#7da33c] transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                            >
                              {shopifySaving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                              Add
                            </button>
                            <button
                              type="button"
                              onClick={() => { setShopifyAdding(false); setSelectedVariant(null); setShopifySearch(""); }}
                              className="py-1.5 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShopifyAdding(true)}
                      className="mt-2 text-xs text-[#96bf48] hover:text-[#7da33c] font-medium transition-colors"
                    >
                      + Add Shopify variant
                    </button>
                  )
                )}

                {shopifyMappings.length === 0 && !canEditShopify && !shopifyAdding && (
                  <p className="text-xs text-muted-foreground italic">No Shopify products linked.</p>
                )}
                {shopifyError && <p className="text-xs text-destructive mt-1">{shopifyError}</p>}
              </div>

              {/* Live ingredient deck — reflects the currently SAVED recipe.
                  Unsaved ingredient edits show after you Save and reopen. */}
              <div className="mt-4 border-t border-border pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <ClipboardList className="w-4 h-4 text-[#7cb342]" />
                  <h4 className="text-sm font-semibold">Ingredient Deck</h4>
                </div>
                <p className="text-xs text-muted-foreground mb-2">Generated from the saved recipe. Save and reopen to see edits reflected.</p>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Label LIVE design:</label>
                  <input
                    value={labelDesign}
                    onChange={e => setLabelDesign(e.target.value)}
                    placeholder="e.g. tck-margherita-back"
                    className="flex-1 min-w-[200px] px-2.5 py-1.5 text-xs font-mono bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {labelDesign.trim() !== labelDesignSaved.trim() && (
                    <button
                      type="button"
                      onClick={saveLabelDesign}
                      disabled={labelDesignSaving}
                      className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                    >
                      {labelDesignSaving ? "Saving…" : "Save"}
                    </button>
                  )}
                  {labelDesignSaved && labelDesign.trim() === labelDesignSaved.trim() && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ mapped</span>
                  )}
                </div>
                <RecipeIngredientDeckPanel id={id} active={open && !isLoading && !isFetching} refreshKey={detail?.ingredients?.length} />
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
  ingredientId?: number | null;
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
  ingredientId?: number | null;
  ingredientName: string | null;
  unit: string | null;
  quantity: number;
  rawQuantity: number;
  processingRatio: number;
  costPerUnit: number;
  lineCostPortion: number;
};

/** ingredientId → {novaClass, novaMarkers} lookup used to put UPF chips on
 *  breakdown rows. Built from the already-cached ingredients list. */
type NovaLookup = Map<number, { novaClass: number | null; novaMarkers: string[] }>;

function SubRecipeBreakdownRow({ sub, servingUnit, novaById, subUpf }: {
  sub: BreakdownSubRecipe;
  servingUnit: string;
  novaById?: NovaLookup;
  subUpf?: { upfPercent?: number | null; upfIngredients: { name: string }[]; unclassifiedIngredients: string[] };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="bg-accent/5 border-t border-border/40">
        <td className="pl-4 pr-2 py-2.5">
          <span className="inline-flex items-center gap-1.5">
            <button
              onClick={() => setOpen(v => !v)}
              className="flex items-center gap-1.5 font-medium text-accent hover:text-accent/80 transition-colors text-sm"
            >
              {open ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
              {sub.subRecipeName ?? "—"}
            </button>
            {subUpf != null && (subUpf.upfPercent ?? 0) > 0 && (
              <UpfPercentPill
                percent={subUpf.upfPercent}
                unclassifiedCount={subUpf.unclassifiedIngredients.length}
                upfNames={subUpf.upfIngredients.map(u => u.name)}
              />
            )}
          </span>
        </td>
        <td className="px-2 py-2.5 text-xs text-muted-foreground text-right">
          {fmtQty(sub.quantity, sub.unit)}
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
            {b.ingredientId != null && (
              <UpfChip
                novaClass={novaById?.get(b.ingredientId)?.novaClass}
                markers={novaById?.get(b.ingredientId)?.novaMarkers}
                className="ml-1"
              />
            )}
          </td>
          <td className="px-2 py-1.5 text-xs text-muted-foreground text-right">
            {fmtQty(b.quantity, b.unit)}
          </td>
          <td className="px-2 py-1.5 text-xs text-muted-foreground text-right">
            £{fmt(b.costPerUnit)}/{b.unit}
          </td>
          <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
            £{fmt(b.allocatedCostPortion)}
            <span className="text-muted-foreground/60">/{servingUnit}</span>
          </td>
        </tr>
      ))}
    </>
  );
}

function RecipeCostBreakdownDialog({ id, open, onOpenChange }: { id: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: detail, isLoading } = useGetRecipe(id, { query: { enabled: open } });
  const { data: allIngredients } = useListIngredients({ query: { enabled: open } });
  const { data: upfSummary } = useGetUpfSummary({ query: { enabled: open } });

  const novaById: NovaLookup = useMemo(
    () => new Map((allIngredients ?? []).map(i => [i.id, { novaClass: i.novaClass ?? null, novaMarkers: i.novaMarkers ?? [] }])),
    [allIngredients],
  );
  const subUpfById = useMemo(
    () => new Map((upfSummary?.subRecipes ?? []).map(s => [s.subRecipeId, s])),
    [upfSummary],
  );
  const recipeUpf = upfSummary?.recipes.find(r => r.recipeId === id);

  const servings = Number(detail?.servings ?? 1);
  const servingUnit = detail?.servingUnit ?? "portion";
  const rawIngredients: BreakdownRawIngredient[] = (detail?.ingredients ?? []).map(i => ({
    ingredientId: (i as { ingredientId?: number }).ingredientId ?? null,
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
            <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              <span>Batch: {servings} {servingUnit} · All costs shown per {servingUnit}</span>
              {recipeUpf && (
                <UpfPercentPill
                  percent={recipeUpf.upfPercent}
                  unclassifiedCount={recipeUpf.unclassifiedIngredients.length}
                  upfNames={recipeUpf.upfIngredients.map(u => u.name)}
                />
              )}
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
                    <td className="pl-4 pr-2 py-2.5 font-medium text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        {r.ingredientName ?? "—"}
                        {r.ingredientId != null && (
                          <UpfChip
                            novaClass={novaById.get(r.ingredientId)?.novaClass}
                            markers={novaById.get(r.ingredientId)?.novaMarkers}
                          />
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <span className="text-xs text-muted-foreground">{fmtQty(r.quantity, r.unit)}</span>
                      {r.processingRatio < 1 && (
                        <span className="block text-xs text-muted-foreground/60">{fmtQty(r.rawQuantity, r.unit)} raw</span>
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
                  <SubRecipeBreakdownRow
                    key={i}
                    sub={s}
                    servingUnit={servingUnit}
                    novaById={novaById}
                    subUpf={s.subRecipeId != null ? subUpfById.get(s.subRecipeId) : undefined}
                  />
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

            {/* Live ingredient deck — what's in it, as it appears on the label */}
            <div className="border-t border-border pt-4">
              <div className="flex items-center gap-2 mb-1">
                <ClipboardList className="w-4 h-4 text-[#7cb342]" />
                <h4 className="text-sm font-semibold">Ingredient Deck</h4>
              </div>
              <RecipeIngredientDeckPanel id={id} active={open && !isLoading} />
            </div>
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
  isCoreMenu?: boolean;
};

interface NutritionalsData {
  totalRawWeightG: number;
  cookingLossPercent: number;
  cookedWeightG: number;
  portionsPerBatch: number;
  servings: number;
  portionWeightG: number;
  packSize: number;
  declaredPackWeightG: number;
  per100g: Record<string, number | null>;
  perPortion: Record<string, number | null>;
  completeness: {
    totalIngredients: number;
    missingNutritionals: string[];
    missingDeclarations: string[];
    missingDeclarationDetail?: { ingredientId: number; name: string }[];
    isComplete: boolean;
  };
}

interface DeckData {
  ingredients: { ingredientId: number; name: string; declaration: string; percentage: number; allergens: string[] }[];
  deckText: string;
  allergens: string[];
  mayContainStatement: string | null;
  missingDeclarations: string[];
  missingDeclarationDetail?: { ingredientId: number; name: string }[];
  isComplete: boolean;
}

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

/** The names from a missing-declarations warning, each linked straight to
 *  that ingredient's edit dialog (via /inventory?edit=) so fixing them is a
 *  tap, not a search. Names the server couldn't id (shouldn't happen) fall
 *  back to plain text. */
function MissingDeclarationLinks({ names, detail }: { names: string[]; detail?: { ingredientId: number; name: string }[] }) {
  const byName = new Map((detail ?? []).map(d => [d.name, d.ingredientId]));
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {names.map(name => {
        const id = byName.get(name);
        return id != null ? (
          <Link
            key={name}
            href={`/inventory?tab=ingredients&edit=${id}`}
            className="underline decoration-dotted underline-offset-2 font-semibold hover:text-amber-900 dark:hover:text-amber-100"
            title={`Open ${name} to add its label declaration`}
          >
            {name}
          </Link>
        ) : (
          <span key={name}>{name}</span>
        );
      })}
    </span>
  );
}

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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="bg-secondary/30 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Raw Weight</p>
                <p className="font-bold">{data.totalRawWeightG}g</p>
              </div>
              <div className="bg-secondary/30 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Cooked Weight</p>
                <p className="font-bold">{data.cookedWeightG}g</p>
                <p className="text-[10px] text-muted-foreground">(-{data.cookingLossPercent}% loss)</p>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 rounded-lg p-3 text-center">
                <p className="text-xs text-emerald-800 dark:text-emerald-300">Portion Weight</p>
                <p className="font-bold text-emerald-900 dark:text-emerald-100">{data.portionWeightG}g</p>
                <p className="text-[10px] text-emerald-700/70 dark:text-emerald-400/70">{data.servings === 1 ? "1 portion recipe" : `÷ ${data.servings} portions`}</p>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 rounded-lg p-3 text-center">
                <p className="text-xs text-emerald-800 dark:text-emerald-300">Pack Weight</p>
                <p className="font-bold text-emerald-900 dark:text-emerald-100">{data.declaredPackWeightG}g</p>
                <p className="text-[10px] text-emerald-700/70 dark:text-emerald-400/70">× {data.packSize} portion{data.packSize !== 1 ? "s" : ""}/pack</p>
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
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Missing label declarations:{" "}
                    <MissingDeclarationLinks names={data.completeness.missingDeclarations} detail={data.completeness.missingDeclarationDetail} />
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Shared deck renderer — fetches the live-generated ingredient deck for a
// recipe and renders it. Used standalone inside the edit + cost-breakdown
// views and wrapped by RecipeIngredientDeckDialog for the card pop-out.
// `active` gates the fetch (so it doesn't run while a parent dialog is shut);
// bump `refreshKey` to force a re-fetch (e.g. after a save).
function RecipeIngredientDeckPanel({ id, active = true, refreshKey }: { id: number; active?: boolean; refreshKey?: number | string }) {
  const [data, setData] = useState<DeckData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<null | "plain" | "label">(null);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    setError(null);
    fetch(`${BASE_URL}/api/recipes/${id}/ingredient-deck`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [active, id, refreshKey]);

  const copyDeck = () => {
    if (!data) return;
    const plain = data.deckText.replace(/\*\*/g, "");
    navigator.clipboard.writeText(plain);
    setCopied("plain");
    setTimeout(() => setCopied(null), 2000);
  };

  // Label Live (the back-label printing software) renders <b> tags, so this
  // variant keeps the allergen emphasis: the server marks every allergen as
  // **X** in deckText, which goes onto the clipboard as <b>X</b>. Mirrors
  // the same button on the Product Hub deck panel.
  const copyForLabelLive = () => {
    if (!data) return;
    const tagged = data.deckText.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    navigator.clipboard.writeText(tagged);
    setCopied("label");
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="text-destructive text-sm py-4">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-4 mt-2">
      <div className="bg-secondary/20 rounded-lg p-4 border border-border">
        <p className="text-sm leading-relaxed" dangerouslySetInnerHTML={{
          __html: data.deckText.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        }} />
        <div className="mt-2 flex items-center gap-4">
          <button type="button" onClick={copyDeck} className="text-xs text-primary hover:underline flex items-center gap-1">
            {copied === "plain" ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy to clipboard</>}
          </button>
          <button type="button" onClick={copyForLabelLive} className="text-xs text-primary hover:underline flex items-center gap-1" title="Copies the deck with <b> tags around allergens, ready to paste into Label Live">
            {copied === "label" ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy for Label Live</>}
          </button>
        </div>
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
          <p className="text-xs text-amber-700 dark:text-amber-300">
            <MissingDeclarationLinks names={data.missingDeclarations} detail={data.missingDeclarationDetail} />
          </p>
        </div>
      )}
    </div>
  );
}

function RecipeIngredientDeckDialog({ id, open, onOpenChange }: { id: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] bg-card border-border rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2"><ClipboardList className="w-5 h-5" /> Ingredient Deck</DialogTitle>
        </DialogHeader>
        <RecipeIngredientDeckPanel id={id} active={open} />
      </DialogContent>
    </Dialog>
  );
}

type RecipeUpfInfo = {
  upfPercent?: number | null;
  upfIngredients: { name: string }[];
  unclassifiedIngredients: string[];
};

function RecipeCard({ recipe, upf, onEdit, onDelete, onBreakdown, onDuplicate }: { recipe: RecipeItem; upf?: RecipeUpfInfo; onEdit: () => void; onDelete: () => void; onBreakdown: () => void; onDuplicate: () => void }) {
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
            <button onClick={() => setNutritionalsOpen(true)} className="w-7 h-7 rounded-full bg-background/90 backdrop-blur text-muted-foreground flex items-center justify-center hover:text-[#7cb342] transition-colors shadow-sm" title="Nutritionals"><Beaker className="w-3 h-3" /></button>
            <button onClick={() => setDeckOpen(true)} className="w-7 h-7 rounded-full bg-background/90 backdrop-blur text-muted-foreground flex items-center justify-center hover:text-[#7cb342] transition-colors shadow-sm" title="Ingredient Deck"><ClipboardList className="w-3 h-3" /></button>
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
              <div className={`text-right font-semibold ${margin != null && margin >= 80 ? "text-green-600" : margin != null && margin >= 75 ? "text-amber-600" : "text-red-600"}`}>
                £{fmt(recipe.rrp - recipe.totalPackCost)}
              </div>
            </>
          )}
        </div>

        {recipe.rrp === 0 && (
          <p className="text-xs text-muted-foreground italic text-center">Set an RRP to see margin</p>
        )}

        <div className="flex justify-between items-center mt-auto pt-1">
          {upf ? (
            <UpfPercentPill
              percent={upf.upfPercent}
              unclassifiedCount={upf.unclassifiedIngredients.length}
              upfNames={upf.upfIngredients.map(u => u.name)}
            />
          ) : <span />}
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
  const { data: upfSummary } = useGetUpfSummary();
  const { createRecipe, deleteRecipe } = useAppMutations();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [breakdownId, setBreakdownId] = useState<number | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);
  const [duplicateDefaults, setDuplicateDefaults] = useState<FormValues | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [coreMenuOnly, setCoreMenuOnly] = useState(false);
  const [viewMode, setViewMode] = useState<"cards" | "table">("table");
  type SortKey = "name" | "category" | "rrp" | "packCost" | "grossProfit" | "gpm" | "upf";
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const { data: duplicateDetail } = useGetRecipe(duplicatingId!, { query: { enabled: duplicatingId !== null } });

  // Union of every tag currently in use across recipes — drives both
  // the filter pill row and the autocomplete suggestions inside the
  // recipe form's TagInput.
  const allTags = (() => {
    const seen = new Map<string, string>();
    for (const r of recipes ?? []) {
      const tags = ((r as Record<string, unknown>).tags as string[] | undefined) ?? [];
      for (const t of tags) {
        const key = t.toLowerCase();
        if (!seen.has(key)) seen.set(key, t);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  })();

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
        targetBuildMinutes: (duplicateDetail as Record<string, unknown>).targetBuildSeconds != null
          ? Number((duplicateDetail as Record<string, unknown>).targetBuildSeconds) / 60
          : null,
        shelfLifeDays: duplicateDetail.shelfLifeDays != null ? Number(duplicateDetail.shelfLifeDays) : undefined,
        tinSize: duplicateDetail.tinSize ?? "",
        maxBatchesPerTin: duplicateDetail.maxBatchesPerTin != null ? Number(duplicateDetail.maxBatchesPerTin) : null,
        sopUrl: duplicateDetail.sopUrl ?? "",
        isCoreMenu: duplicateDetail.isCoreMenu ?? false,
        isCurrentSpecial: false,
        isFridgeProduct: (duplicateDetail as Record<string, unknown>).isFridgeProduct === true,
        color: duplicateDetail.color ?? "",
        cookingLossPercent: (duplicateDetail as Record<string, unknown>).cookingLossPercent != null ? Number((duplicateDetail as Record<string, unknown>).cookingLossPercent) : 3,
        builderFillingDeductionGrams: Number(duplicateDetail.builderFillingDeductionGrams ?? 0),
        dietaryCategory: ((duplicateDetail as Record<string, unknown>).dietaryCategory as "meat" | "vegetarian" | null | undefined) ?? null,
        tags: Array.isArray((duplicateDetail as Record<string, unknown>).tags) ? ((duplicateDetail as Record<string, unknown>).tags as string[]) : [],
        ingredients: (duplicateDetail.ingredients ?? []).map(i => ({ ingredientId: i.ingredientId, quantity: Number(i.quantity), marinadeForIngredientId: i.marinadeForIngredientId ?? null, marinadeAddAtCooking: (i as { marinadeAddAtCooking?: boolean | null }).marinadeAddAtCooking === true, includeInFillingMix: i.includeInFillingMix ?? false, isTopping: (i as Record<string, unknown>).isTopping === true, quid: (i as Record<string, unknown>).quid === true, showInPrep: (i as Record<string, unknown>).showInPrep === true, mixingOverage: Number((i as Record<string, unknown>).mixingOverage ?? 0) })),
        subRecipes: (duplicateDetail.subRecipes ?? []).map(s => ({ subRecipeId: s.subRecipeId, quantity: Number(s.quantity), marinadeForIngredientId: s.marinadeForIngredientId ?? null, marinadeAddAtCooking: (s as { marinadeAddAtCooking?: boolean | null }).marinadeAddAtCooking === true, includeInFillingMix: s.includeInFillingMix ?? false, isTopping: (s as Record<string, unknown>).isTopping === true, quid: (s as Record<string, unknown>).quid === true, showInPrep: (s as Record<string, unknown>).showInPrep === true, mixingOverage: Number((s as Record<string, unknown>).mixingOverage ?? 0) })),
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
    supplierName: (i as unknown as { supplierName?: string | null }).supplierName ?? null,
    novaClass: i.novaClass ?? null,
    novaMarkers: i.novaMarkers ?? [],
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
    packSize: 1, rrp: 0, packagingCost: 0, labourCost: 0, portionsPerBatch: 10, targetBuildMinutes: null, shelfLifeDays: undefined,
    tinSize: "", maxBatchesPerTin: null, sopUrl: "", isCoreMenu: false, isCurrentSpecial: false, isFridgeProduct: false, color: "", cookingLossPercent: 3, builderFillingDeductionGrams: 0, dietaryCategory: null, tags: [], ingredients: [], subRecipes: [],
  };

  // Shared filter for both card and table views.
  const filteredRecipes = (recipes ?? []).filter(r => {
    if (coreMenuOnly && !(r as RecipeItem).isCoreMenu) return false;
    if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      if (!r.name.toLowerCase().includes(q)) return false;
    }
    if (selectedTags.length > 0) {
      const rTags = ((r as Record<string, unknown>).tags as string[] | undefined) ?? [];
      const rLower = new Set(rTags.map(t => t.toLowerCase()));
      for (const sel of selectedTags) if (!rLower.has(sel.toLowerCase())) return false;
    }
    return true;
  });

  const recipeUpfById = useMemo(
    () => new Map((upfSummary?.recipes ?? []).map(r => [r.recipeId, r])),
    [upfSummary],
  );

  // Table sort. Recipes with no RRP set (no margin) sort to the bottom on
  // the money columns regardless of direction's natural ordering.
  const sortValue = (r: RecipeItem, key: SortKey): number | string => {
    const rrp = Number(r.rrp) || 0;
    switch (key) {
      case "name": return r.name.toLowerCase();
      case "category": return (r.category ?? "").toLowerCase();
      case "rrp": return rrp;
      case "packCost": return Number(r.totalPackCost) || 0;
      case "grossProfit": return rrp > 0 ? rrp - (Number(r.totalPackCost) || 0) : Number.NEGATIVE_INFINITY;
      case "gpm": return r.grossMargin == null ? Number.NEGATIVE_INFINITY : Number(r.grossMargin);
      case "upf": {
        const pct = recipeUpfById.get(r.id)?.upfPercent;
        return pct == null ? Number.NEGATIVE_INFINITY : pct;
      }
    }
  };
  const sortedRecipes = [...filteredRecipes].sort((a, b) => {
    const av = sortValue(a as RecipeItem, sortKey);
    const bv = sortValue(b as RecipeItem, sortKey);
    const cmp = (typeof av === "string" || typeof bv === "string")
      ? String(av).localeCompare(String(bv))
      : av - bv;
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) { setSortDir(d => (d === "asc" ? "desc" : "asc")); }
    else { setSortKey(key); setSortDir(key === "name" || key === "category" ? "asc" : "desc"); }
  };
  // Sortable <th>. Numeric columns right-align and default to descending.
  const sortTh = (label: string, key: SortKey, align: "left" | "right" = "left") => (
    <th
      onClick={() => toggleSort(key)}
      className={cn("py-2.5 px-3 font-semibold select-none cursor-pointer hover:text-foreground transition-colors", align === "right" ? "text-right" : "text-left")}
    >
      <span className={cn("inline-flex items-center gap-1", align === "right" && "flex-row-reverse")}>
        {label}
        {sortKey === key
          ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
          : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </span>
    </th>
  );

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

      {/* Margin legend + category filter */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> ≥80% — Great</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-400 inline-block" /> 75–79% — OK</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> &lt;75% — Review</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border overflow-hidden mr-1">
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
          <Filter className="w-4 h-4 text-muted-foreground" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
          >
            <option value="all">All Categories</option>
            {[...new Set((recipes ?? []).map(r => r.category).filter((c): c is string => !!c))].sort().map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCoreMenuOnly(v => !v)}
            aria-pressed={coreMenuOnly}
            className={cn(
              "text-sm rounded-lg px-3 py-1.5 border font-medium transition-colors",
              coreMenuOnly
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/50"
            )}
            title="Show only core menu items"
          >
            Core menu only
          </button>
        </div>
      </div>

      {/* Search + tag filter — both AND together with the category dropdown above. */}
      <div className="space-y-2">
        <div className="relative max-w-md">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search recipes by name…"
            className="w-full px-3 py-2 pr-8 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1">Tags:</span>
            {allTags.map(tag => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedTags(active
                    ? selectedTags.filter(t => t !== tag)
                    : [...selectedTags, tag]
                  )}
                  className={cn(
                    "px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors",
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                  )}
                >
                  {tag}
                </button>
              );
            })}
            {selectedTags.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTags([])}
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline ml-1"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add dialog */}
      <Dialog open={isAddOpen} onOpenChange={(v) => { setIsAddOpen(v); if (!v) setDuplicateDefaults(null); }}>
        <DialogContent className="sm:max-w-[min(96vw,1100px)] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-xl">{duplicateDefaults ? "Duplicate Final Product" : "New Final Product"}</DialogTitle></DialogHeader>
          <RecipeForm
            key={duplicateDefaults ? "duplicate" : "new"}
            defaultValues={duplicateDefaults ?? addDefaults}
            isEdit={false}
            isPending={createRecipe.isPending}
            ingredients={ingredientList}
            subRecipes={subRecipeList}
            categoryDefaults={catDefaults}
            allTags={allTags}
            onSubmit={(data) => {
              // isFridgeProduct rides its own endpoint — the create body's
              // validator is OpenAPI-generated and would drop it.
              const { targetBuildMinutes, isFridgeProduct, ...rest } = data;
              const payload = {
                ...rest,
                targetBuildSeconds: targetBuildMinutes != null ? Math.round(targetBuildMinutes * 60) : null,
              } as unknown as typeof data;
              createRecipe.mutate({ data: payload }, {
                onSuccess: (created) => {
                  const newId = (created as { id?: number } | undefined)?.id;
                  if (isFridgeProduct === true && newId) {
                    fetch(`/api/recipes/${newId}/fridge-product`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ isFridgeProduct: true }),
                    }).catch(() => {});
                  }
                  setIsAddOpen(false); setDuplicateDefaults(null);
                },
              });
            }}
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
          allTags={allTags}
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

      {viewMode === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredRecipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe as RecipeItem}
              upf={recipeUpfById.get(recipe.id)}
              onEdit={() => setEditingId(recipe.id)}
              onDelete={() => { if (confirm(`Delete "${recipe.name}"?`)) deleteRecipe.mutate({ id: recipe.id }); }}
              onBreakdown={() => setBreakdownId(recipe.id)}
              onDuplicate={() => setDuplicatingId(recipe.id)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto glass-panel rounded-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                {sortTh("Recipe", "name")}
                {sortTh("Category", "category")}
                {sortTh("RRP", "rrp", "right")}
                {sortTh("Total pack cost", "packCost", "right")}
                {sortTh("Gross profit", "grossProfit", "right")}
                {sortTh("GP margin", "gpm", "right")}
                {sortTh("UPF", "upf", "right")}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {sortedRecipes.map((r0) => {
                const r = r0 as RecipeItem;
                const rrp = Number(r.rrp) || 0;
                const hasRrp = rrp > 0;
                const gp = rrp - (Number(r.totalPackCost) || 0);
                const m = r.grossMargin;
                const mColor = m == null ? "text-muted-foreground" : m >= 80 ? "text-green-600" : m >= 75 ? "text-amber-600" : "text-red-600";
                const color = (r as Record<string, unknown>).color as string | undefined;
                return (
                  <tr
                    key={r.id}
                    onClick={() => setEditingId(r.id)}
                    className="border-b border-border/50 hover:bg-secondary/40 cursor-pointer"
                  >
                    <td className="py-2.5 px-3 font-medium">
                      <span className="inline-flex items-center gap-2">
                        {color && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
                        {r.name}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">{r.category ?? "—"}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{hasRrp ? `£${fmt(rrp)}` : "—"}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">£{fmt(r.totalPackCost)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{hasRrp ? `£${fmt(gp)}` : "—"}</td>
                    <td className={cn("py-2.5 px-3 text-right tabular-nums font-semibold", mColor)}>{m == null ? "—" : `${m.toFixed(1)}%`}</td>
                    <td className="py-2.5 px-3 text-right">
                      {(() => {
                        const upf = recipeUpfById.get(r.id);
                        return (
                          <UpfPercentPill
                            percent={upf?.upfPercent}
                            unclassifiedCount={upf?.unclassifiedIngredients.length ?? 0}
                            upfNames={upf?.upfIngredients.map(u => u.name)}
                          />
                        );
                      })()}
                    </td>
                    <td className="py-2.5 px-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setBreakdownId(r.id)}
                        title="Cost breakdown"
                        className="text-muted-foreground hover:text-foreground p-1"
                      >
                        <BarChart2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {sortedRecipes.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-muted-foreground text-sm">No recipes match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
