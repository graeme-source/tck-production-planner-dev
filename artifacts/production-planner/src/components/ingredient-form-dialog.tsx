/**
 * Full-fat ingredient / supply edit dialog. Used by both the Inventory
 * page and the Quick-Add affordance on the recipe / sub-recipe edit
 * screens, so anywhere an ingredient can be created the operator gets
 * the *same* set of fields — supplier, category, packaging, stock
 * check, kanban, nutritionals — without having to leave the screen,
 * finish setup elsewhere, and come back.
 *
 * Schema, value-shaping and payload-building helpers all live in
 * lib/ingredient-form.ts so this file is purely UI + wiring.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Carrot, Box, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Ingredient } from "@workspace/api-client-react";
import {
  ingredientFormSchema,
  emptyIngredientFormDefaults,
  ingredientToFormValues,
  type IngredientFormValues,
} from "@/lib/ingredient-form";

export type IngredientFormMode = "ingredient" | "supply";

export const INGREDIENT_CATEGORIES = [
  { value: "", label: "— No category —" },
  { value: "raw_meat", label: "Raw Meat" },
  { value: "cooked_meat", label: "Cooked Meat" },
  { value: "vegetable", label: "Vegetable" },
  { value: "base", label: "Base (Sauce/Mozzarella)" },
  { value: "sauce", label: "Sauce" },
  { value: "cheese", label: "Cheese" },
  { value: "seasoning", label: "Seasoning/Spice" },
  { value: "pasta", label: "Pasta" },
  { value: "dough", label: "Dough" },
  { value: "packaging", label: "Packaging" },
  { value: "other", label: "Other" },
] as const;

export const SUPPLY_CATEGORIES = [
  { value: "", label: "— No category —" },
  { value: "packaging", label: "Packaging & Containers" },
  { value: "courier", label: "Courier & Shipping" },
  { value: "insulation", label: "Insulation & Cool Packs" },
  { value: "tape_labels", label: "Tape & Labels" },
  { value: "cleaning", label: "Cleaning Supplies" },
  { value: "trays", label: "Trays & Bakeware" },
  { value: "other", label: "Other" },
] as const;

export const UK14_ALLERGENS = [
  { value: "celery", label: "Celery" },
  { value: "cereals_containing_gluten", label: "Cereals containing Gluten" },
  { value: "crustaceans", label: "Crustaceans" },
  { value: "eggs", label: "Eggs" },
  { value: "fish", label: "Fish" },
  { value: "lupin", label: "Lupin" },
  { value: "milk", label: "Milk" },
  { value: "molluscs", label: "Molluscs" },
  { value: "mustard", label: "Mustard" },
  { value: "nuts", label: "Nuts" },
  { value: "peanuts", label: "Peanuts" },
  { value: "sesame", label: "Sesame" },
  { value: "soybeans", label: "Soybeans" },
  { value: "sulphur_dioxide", label: "Sulphur Dioxide" },
] as const;

export function categoryLabel(value: string | null | undefined, isPerishable: boolean): string {
  const cats = isPerishable ? INGREDIENT_CATEGORIES : SUPPLY_CATEGORIES;
  return (cats as readonly { value: string; label: string }[]).find(c => c.value === value)?.label ?? value ?? "—";
}

/** Caller-supplied wrapper around the inventory CRUD. The dialog
 *  just calls `onSave(data, editingItem?.id ?? null)` after Zod
 *  validation — the caller decides whether to fire a create or update
 *  mutation, what the success toast says, etc. */
export function IngredientFormDialog({
  open, onClose, editingItem, defaultMode, suppliers, onSave, lockMode,
}: {
  open: boolean;
  onClose: () => void;
  editingItem: Ingredient | null;
  defaultMode: IngredientFormMode;
  suppliers: { id: number; name: string }[];
  onSave: (data: IngredientFormValues, id: number | null) => void;
  /** When true, the ingredient/supply tab toggle is hidden. Used by
   *  Quick-Add where the caller already knows the mode. */
  lockMode?: boolean;
}) {
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<IngredientFormValues>({
    resolver: zodResolver(ingredientFormSchema),
    defaultValues: emptyIngredientFormDefaults(defaultMode),
  });

  const formMode = watch("formMode") ?? defaultMode;
  const isIngredient = formMode === "ingredient";
  const watchedUnit = watch("unit");
  const watchedPackWeight = watch("packWeight");
  const watchedCostPerPack = watch("costPerPack");
  const watchedProcessingRatioPct = watch("processingRatioPct");
  const watchedStockCheckEnabled = watch("stockCheckEnabled");
  const watchedStockCheckFrequency = watch("stockCheckFrequency");
  const watchedCategory = watch("category");
  const watchedKanbanEnabled = watch("kanbanEnabled");
  const liveCostPerUnit = watchedPackWeight > 0 ? watchedCostPerPack / watchedPackWeight : null;
  const showRawMeatTray = isIngredient && watchedCategory === "raw_meat";

  const populateForm = (item: Ingredient | null, mode: IngredientFormMode) => {
    if (!item) { reset(emptyIngredientFormDefaults(mode)); return; }
    reset(ingredientToFormValues(item, mode));
  };

  const [initialized, setInitialized] = useState(false);
  const [nutritionOpen, setNutritionOpen] = useState(false);
  if (open && !initialized) { populateForm(editingItem, defaultMode); setInitialized(true); }
  if (!open && initialized) { setInitialized(false); setNutritionOpen(false); }

  const switchMode = (mode: IngredientFormMode) => {
    setValue("formMode", mode);
    setValue("category", "");
  };

  const watchedAllergens = watch("allergens") ?? [];
  const toggleAllergen = (val: string) => {
    const cur = watchedAllergens;
    setValue("allergens", cur.includes(val) ? cur.filter((a: string) => a !== val) : [...cur, val]);
  };

  const onSubmit = (data: IngredientFormValues) => {
    onSave(data, editingItem?.id ?? null);
  };

  const inputClass = "w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
  const numInputClass = "w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[640px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto z-[200]">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {editingItem ? "Edit Item" : "Add New Item"}
          </DialogTitle>
        </DialogHeader>

        {!lockMode && (
          <>
            <div className="flex gap-1 p-1 bg-secondary/40 rounded-xl mt-2 mb-1">
              <button
                type="button"
                onClick={() => switchMode("ingredient")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all",
                  formMode === "ingredient"
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Carrot className="w-4 h-4" /> Ingredient
              </button>
              <button
                type="button"
                onClick={() => switchMode("supply")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all",
                  formMode === "supply"
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Box className="w-4 h-4" /> Supply
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-4 text-center">
              {formMode === "ingredient"
                ? "Perishable food item used in recipes"
                : "Non-perishable packaging, courier materials or supplies"}
            </p>
          </>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1 block">Name *</label>
              <input {...register("name")} className={inputClass} placeholder={formMode === "ingredient" ? "e.g. Organic Plain Flour" : "e.g. Courier Box (Large)"} />
              {errors.name && <span className="text-destructive text-xs">{errors.name.message}</span>}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Unit *</label>
              <select {...register("unit")} className={inputClass}>
                <option value="kg">kg</option>
                <option value="g">g</option>
                <option value="l">L</option>
                <option value="ml">ml</option>
                <option value="pieces">pieces</option>
                {formMode === "supply" && (
                  <>
                    <option value="box">box</option>
                    <option value="bag">bag</option>
                    <option value="tub">tub</option>
                    <option value="each">each</option>
                    <option value="roll">roll</option>
                    <option value="sheet">sheet</option>
                  </>
                )}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Brand</label>
              <input {...register("brand")} className={inputClass} placeholder="e.g. Jiffy" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Supplier Part No.</label>
              <input {...register("supplierPartNumber")} className={inputClass} placeholder="e.g. JF-BOX-L" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Pack size ({watchedUnit || "unit"}) *</label>
              <input type="number" step="0.001" {...register("packWeight")} className={numInputClass} placeholder="e.g. 50" />
              <p className="text-xs text-muted-foreground mt-1">How many {watchedUnit || "units"} in one pack</p>
              {errors.packWeight && <span className="text-destructive text-xs">{errors.packWeight.message}</span>}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Cost per pack (£) *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">£</span>
                <input type="number" step="0.01" {...register("costPerPack")} className="w-full pl-7 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="0.00" />
              </div>
              {errors.costPerPack && <span className="text-destructive text-xs">{errors.costPerPack.message}</span>}
            </div>
          </div>

          {liveCostPerUnit !== null && (
            <div className="rounded-lg bg-secondary/30 border border-border px-3.5 py-2.5 text-sm flex items-center justify-between">
              <span className="text-muted-foreground">Implied cost per {watchedUnit || "unit"}:</span>
              <span className="font-semibold tabular-nums">£{liveCostPerUnit.toFixed(4)} / {watchedUnit || "unit"}</span>
            </div>
          )}

          {!isIngredient && (
            <div>
              <label className="text-sm font-medium mb-1 block">Pallet Size <span className="text-xs font-normal text-muted-foreground">(packs per pallet)</span></label>
              <input type="number" step="1" min="1" {...register("palletSize")} className={cn(numInputClass, "max-w-[160px]")} placeholder="e.g. 48" />
              <p className="text-xs text-muted-foreground mt-1">How many packs fit on a full pallet. Used for bulk ordering calculations.</p>
              {errors.palletSize && <span className="text-destructive text-xs">{String(errors.palletSize.message)}</span>}
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1 block">
              {isIngredient ? "Ingredient Category" : "Supply Category"}
            </label>
            <select {...register("category")} className={inputClass}>
              {(isIngredient ? INGREDIENT_CATEGORIES : SUPPLY_CATEGORIES).map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {isIngredient && (
            <>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Processing Ratio <span className="text-xs font-normal text-muted-foreground">(unchopped → chopped / raw → cooked)</span>
                </label>
                <div className="relative max-w-[160px]">
                  <input type="number" step="0.01" min="0" max="100" {...register("processingRatioPct")} className={cn(numInputClass, "pr-8")} placeholder="e.g. 84.70" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">%</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Leave blank for 100% (no loss). Adjusts sub-recipe yield.</p>
                {errors.processingRatioPct && <span className="text-destructive text-xs">{String(errors.processingRatioPct.message)}</span>}
              </div>

              {watchedProcessingRatioPct != null && watchedProcessingRatioPct < 100 && (
                <div className="pl-4 border-l-2 border-primary/20">
                  <label className="text-sm font-medium mb-1 block">Prep Weighing Point</label>
                  <select {...register("prepWeightMode")} className={cn(numInputClass, "max-w-[280px]")}>
                    <option value="raw">Raw weight (weigh before processing)</option>
                    <option value="processed">Processed weight (weigh after processing)</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Controls which weight the prep station shows. Use "processed" for ingredients where staff chop/pick then weigh the exact amount (e.g. basil, fresh veg).
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium mb-1 block">Shelf Life <span className="text-xs font-normal text-muted-foreground">(days)</span></label>
                <div className="relative max-w-[160px]">
                  <input type="number" step="1" min="1" {...register("shelfLifeDays")} className={cn(numInputClass, "pr-12")} placeholder="e.g. 7" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">days</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Auto-calculates use-by dates on deliveries.</p>
              </div>

              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" {...register("requiresUseByDate")} className="w-4 h-4 rounded border-border" />
                  <span className="text-sm font-medium">Require use-by date at goods-in</span>
                </label>
                <p className="text-xs text-muted-foreground mt-1 ml-6">When on, staff must enter a use-by date for this ingredient when receiving a delivery.</p>
              </div>

              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" {...register("stockInPacks")} className="w-4 h-4 rounded border-border" />
                  <span className="text-sm font-medium">Count stock in whole packs</span>
                </label>
                <p className="text-xs text-muted-foreground mt-1 ml-6">
                  Stock check, ordering and goods-in count this in whole {watchedUnit === "ml" || watchedUnit === "l" ? "bottles" : "packs"} instead of {watchedUnit || "weight"}. Recipes and prep still use {watchedUnit || "the native unit"}. Requires Pack size.
                </p>
                {errors.stockInPacks && <span className="text-destructive text-xs ml-6 block mt-1">{String(errors.stockInPacks.message)}</span>}
              </div>

              <div className="bg-secondary/30 rounded-lg px-4 py-3">
                <label className="text-sm font-medium mb-1 block">
                  Prep count per portion
                  <span className="ml-2 text-xs font-normal text-muted-foreground">(optional)</span>
                </label>
                <div className="relative max-w-[160px]">
                  <input
                    type="number"
                    step="1"
                    min="1"
                    {...register("prepCountPerPortion")}
                    className={cn(numInputClass, "pr-14")}
                    placeholder="e.g. 2"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">pieces</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  When set, the prep station shows this ingredient as a count of pieces (portions × this number) instead of weight — e.g. Pigs &amp; Blankets at 2 per portion for a 24-portion batch renders as &ldquo;48 pieces&rdquo;. Recipe quantity stays in the ingredient&rsquo;s native unit for ordering and stock. Leave blank for normal weight-based prep.
                </p>
                {errors.prepCountPerPortion && <span className="text-destructive text-xs">{String(errors.prepCountPerPortion.message)}</span>}
              </div>
            </>
          )}

          {showRawMeatTray && (
            <div className="pl-4 border-l-2 border-primary/20 flex flex-col gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Tray Capacity <span className="text-xs font-normal text-muted-foreground">(kg per tray)</span></label>
                <div className="relative max-w-[160px]">
                  <input type="number" step="0.1" min="0" {...register("rawMeatTrayCapacityKg")} className={cn(numInputClass, "pr-10")} placeholder="e.g. 10" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">kg</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Min Cooking Temp <span className="text-xs font-normal text-muted-foreground">(°C)</span></label>
                <div className="relative max-w-[160px]">
                  <input type="number" step="1" min="0" max="300" {...register("minCookingTempC")} className={cn(numInputClass, "pr-10")} placeholder="e.g. 75" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">°C</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Estimated Cook Time <span className="text-xs font-normal text-muted-foreground">(minutes)</span></label>
                <div className="relative max-w-[160px]">
                  <input type="number" step="1" min="1" {...register("estimatedCookTimeMin")} className={cn(numInputClass, "pr-12")} placeholder="e.g. 45" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">min</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Oven Temperature <span className="text-xs font-normal text-muted-foreground">(°C)</span></label>
                <div className="relative max-w-[160px]">
                  <input type="number" step="1" min="0" max="500" {...register("ovenTempC")} className={cn(numInputClass, "pr-10")} placeholder="e.g. 180" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">°C</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Steam %</label>
                <select {...register("steamPct")} className={cn(inputClass, "max-w-[160px]")}>
                  <option value="">— not set —</option>
                  {[0,10,20,30,40,50,60,70,80,90,100].map(v => <option key={v} value={v}>{v}%</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Primary Supplier</label>
              <select {...register("supplierId")} className={inputClass}>
                <option value="0">— No supplier —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Secondary Supplier</label>
              <select {...register("secondarySupplierId")} className={inputClass}>
                <option value="0">— None —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Ordering URL</label>
            <input {...register("orderingUrl")} className={inputClass} placeholder="https://..." />
          </div>

          <div className="flex items-center gap-3 py-1">
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" {...register("stockCheckEnabled")} className="sr-only peer" />
              <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
            </label>
            <div>
              <span className="text-sm font-medium">Requires Stock Check</span>
              <p className="text-xs text-muted-foreground">Operators must record remaining stock during Main Prep.</p>
            </div>
          </div>

          {watchedStockCheckEnabled && (
            <div className="pl-4 border-l-2 border-primary/20 flex flex-col gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Check Frequency</label>
                <select {...register("stockCheckFrequency")} className={inputClass}>
                  <option value="daily">Daily — check every production day</option>
                  <option value="weekly">Weekly — check on a specific day only</option>
                </select>
              </div>
              {watchedStockCheckFrequency === "weekly" && (
                <div>
                  <label className="text-sm font-medium mb-1 block">Check Day</label>
                  <select {...register("stockCheckDay")} className={inputClass}>
                    <option value="">— Select a day —</option>
                    {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-sm font-medium mb-1 block">Surplus % <span className="text-xs font-normal text-muted-foreground">(ordering buffer)</span></label>
                <div className="relative max-w-[160px]">
                  <input type="number" step="1" min="0" {...register("surplusPercent")} className={cn(numInputClass, "pr-8")} placeholder="10" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">%</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 py-1">
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" {...register("kanbanEnabled")} className="sr-only peer" />
              <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
            </label>
            <div>
              <span className="text-sm font-medium">Kanban Enabled</span>
              <p className="text-xs text-muted-foreground">Item appears in the kanban reorder system.</p>
            </div>
          </div>

          {watchedKanbanEnabled && (
            <div className="pl-4 border-l-2 border-primary/20 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Kanban Unit</label>
                  <select {...register("kanbanUnit")} className={inputClass}>
                    <option value="weight">Weight (kg/g/L)</option>
                    <option value="pack">Pack</option>
                    <option value="bottle">Bottle</option>
                    <option value="pallet">Pallet</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Trigger Quantity</label>
                  <input type="number" step="0.1" min="0" {...register("kanbanQuantity")} className={numInputClass} placeholder="e.g. 10" />
                  <p className="text-xs text-muted-foreground mt-1">Pull card when stock reaches this level.</p>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Order Amount</label>
                <input type="number" step="0.1" min="0" {...register("kanbanOrderAmount")} className={cn(numInputClass, "max-w-[160px]")} placeholder="e.g. 50" />
                <p className="text-xs text-muted-foreground mt-1">Quantity to order when card is pulled.</p>
              </div>
            </div>
          )}

          {isIngredient && (
            <div className="border border-amber-300/50 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setNutritionOpen(!nutritionOpen)}
                className="w-full flex items-center justify-between px-4 py-3 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
              >
                <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">Nutritionals &amp; Labelling</span>
                <ChevronDown className={cn("w-4 h-4 text-amber-600 transition-transform", nutritionOpen && "rotate-180")} />
              </button>
              {nutritionOpen && (
                <div className="px-4 py-4 space-y-4 bg-card">
                  <p className="text-xs text-muted-foreground">All values per 100 g as supplied.</p>
                  <div className="grid grid-cols-4 gap-3">
                    {([
                      { field: "energyKj", label: "Energy (kJ)" },
                      { field: "energyKcal", label: "Energy (kcal)" },
                      { field: "fat", label: "Fat (g)" },
                      { field: "saturates", label: "Saturates (g)" },
                      { field: "carbohydrate", label: "Carbs (g)" },
                      { field: "sugars", label: "Sugars (g)" },
                      { field: "protein", label: "Protein (g)" },
                      { field: "fibre", label: "Fibre (g)" },
                      { field: "salt", label: "Salt (g)" },
                    ] as const).map(({ field, label }) => (
                      <div key={field}>
                        <label className="text-xs font-medium mb-1 block">{label}</label>
                        <input type="number" step="0.01" min="0" {...register(field)} className={numInputClass} placeholder="0.00" />
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Label Declaration</label>
                    <textarea {...register("labelDeclaration")} rows={2} className={cn(inputClass, "resize-none")} placeholder='e.g. "Wheat Flour (Wheat, Calcium Carbonate, Iron, Niacin, Thiamin)"' />
                    <p className="text-xs text-muted-foreground mt-1">How this ingredient appears in the product ingredient deck.</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Allergens (UK14)</label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {UK14_ALLERGENS.map(a => (
                        <button
                          key={a.value}
                          type="button"
                          onClick={() => toggleAllergen(a.value)}
                          className={cn(
                            "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                            watchedAllergens.includes(a.value)
                              ? "bg-red-100 border-red-300 text-red-800 dark:bg-red-900/40 dark:border-red-700 dark:text-red-300"
                              : "bg-secondary/40 border-border text-muted-foreground hover:bg-secondary",
                          )}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1 block">Notes</label>
            <textarea {...register("notes")} rows={2} className={cn(inputClass, "resize-none")} placeholder="Any additional notes..." />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-border hover:bg-secondary/50 transition-colors">Cancel</button>
            <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm shadow-primary/20">
              {editingItem ? "Save Changes" : formMode === "ingredient" ? "Add Ingredient" : "Add Supply"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
