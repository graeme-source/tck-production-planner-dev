import React, { useState, useEffect, useCallback } from "react";
import { useCreateBatchCompletion, getGetProductionPlanQueryKey, getListProductionPlansQueryKey } from "@workspace/api-client-react";
import type { ProductionPlanDetail, ProductionPlanItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Plus, Minus, CheckCircle2, Check, Thermometer, Clock,
  UtensilsCrossed, ChefHat, Package, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { useAuth } from "@/contexts/auth-context";
import { BreakTracker } from "../shared/break-tracker";
import { getStationCount, isMacCheese } from "../shared/constants";

// ──────────────────────────────────────────────────────────────────────────────
// Macaroni Cheese Station
// ──────────────────────────────────────────────────────────────────────────────

interface PrepIngredient {
  ingredientId: number;
  ingredientName: string;
  unit: string;
  totalQty: number;
  section: "pasta" | "sauce" | "topping";
}

function useMacCheesePrep(planId: number, macItems: ProductionPlanItem[]) {
  const [ingredients, setIngredients] = useState<PrepIngredient[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (macItems.length === 0) { setIngredients([]); setLoading(false); return; }
    fetch(`/api/production-plans/${planId}/prep-requirements?station=all`, { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        // Filter to only ingredients from mac cheese recipes
        const macRecipeIds = new Set(macItems.map(it => it.recipeId));
        const allIngredients: PrepIngredient[] = [];
        for (const item of (data ?? [])) {
          if (!macRecipeIds.has(item.recipeId)) continue;
          for (const ing of item.ingredients ?? []) {
            allIngredients.push({
              ingredientId: ing.ingredientId,
              ingredientName: ing.ingredientName,
              unit: ing.unit ?? "kg",
              totalQty: ing.totalQty ?? 0,
              section: classifyIngredient(ing.ingredientName),
            });
          }
        }
        // Aggregate by ingredient across recipes
        const agg = new Map<number, PrepIngredient>();
        for (const ing of allIngredients) {
          const existing = agg.get(ing.ingredientId);
          if (existing) { existing.totalQty += ing.totalQty; }
          else { agg.set(ing.ingredientId, { ...ing }); }
        }
        setIngredients([...agg.values()]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [planId, macItems.length]);

  return { ingredients, loading };
}

function classifyIngredient(name: string): "pasta" | "sauce" | "topping" {
  const lower = name.toLowerCase();
  if (lower.includes("macaroni") || lower.includes("pasta") || lower.includes("water") || lower.includes("salt")) return "pasta";
  if (lower.includes("panko") || lower.includes("breadcrumb") || lower.includes("parsley")) return "topping";
  // Default to sauce (cheese, milk, cream, flour, butter, mustard, seasoning)
  return "sauce";
}

function formatQty(qty: number, unit: string): string {
  if (unit === "kg") return `${qty.toFixed(3)} kg`;
  if (unit === "g") {
    if (qty >= 1000) return `${(qty / 1000).toFixed(3)} kg`;
    return `${qty.toFixed(0)} g`;
  }
  if (unit === "ml") {
    if (qty >= 1000) return `${(qty / 1000).toFixed(3)} L`;
    return `${qty.toFixed(0)} ml`;
  }
  return `${qty % 1 === 0 ? qty : qty.toFixed(3)} ${unit}`;
}

interface TempRecord {
  id: number;
  recordType: string;
  temperatureC: string;
  recordedAt: string;
  userName: string | null;
}

interface MacCheeseCalcRecipe {
  recipeId: number;
  recipeName: string;
  color: string | null;
  packsPerBatch: number;
  leftOverStock: number;
  salesNextDay: number;
  salesNextDayPlus1: number;
  salesNextDayPlus2: number;
  neededForDispatch: number;
  extraToMake: number;
  toMakePacks: number;
  toMakeBatches: number;
}

function InlineAddMacCheese({ planId, planDate, onSuccess }: { planId: number; planDate: string; onSuccess: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recipes, setRecipes] = useState<MacCheeseCalcRecipe[]>([]);
  const [extraOverrides, setExtraOverrides] = useState<Record<number, number>>({});

  useEffect(() => {
    setLoading(true);
    // Reuse the existing /calculate endpoint (proven Shopify matching) and filter to mac cheese
    Promise.all([
      fetch(`/api/production-plans/calculate?planDate=${planDate}`, { credentials: "include" }).then(r => r.json()),
      // Fetch per-recipe extra-to-make defaults
      fetch(`/api/recipes`, { credentials: "include" }).then(r => r.json()),
    ])
      .then(([calcData, allRecipes]) => {
        const macRecipeIds = new Set(
          (allRecipes ?? []).filter((r: any) => r.category === "Macaroni Cheese").map((r: any) => r.id)
        );
        // Filter calculate results to only mac cheese recipes
        const macCalcRecipes = (calcData.recipes ?? []).filter((r: any) => macRecipeIds.has(r.recipeId));

        // Also include mac cheese recipes that aren't in the calculate response (no DPT settings)
        const calcRecipeIds = new Set(macCalcRecipes.map((r: any) => r.recipeId));
        const missingRecipes = (allRecipes ?? [])
          .filter((r: any) => r.category === "Macaroni Cheese" && !calcRecipeIds.has(r.id))
          .map((r: any) => ({
            recipeId: r.id,
            recipeName: r.name,
            color: r.color ?? null,
            packsPerBatch: (r.portionsPerBatch ?? 10) / (Number(r.packSize) || 2),
            leftOverStock: 0,
            salesNextDay: 0,
            salesNextDayPlus1: 0,
            salesNextDayPlus2: 0,
            neededForDispatch: 0,
            extraToMake: 5,
            toMakePacks: 5,
            toMakeBatches: 1,
          }));

        // Thursday = no extra (last prod day before weekend)
        const planDow = new Date(`${planDate}T12:00:00Z`).getUTCDay();
        const isThursday = planDow === 4;
        const defaultExtra = isThursday ? 0 : 5;

        // Map calculate response to our format
        const mapped: MacCheeseCalcRecipe[] = macCalcRecipes.map((r: any) => {
          const stock = r.estimatedFactoryNumber ?? r.fridgeStock ?? 0;
          const d1 = r.dispatch2Qty ?? 0; // dispatch2 = today's dispatch (next day sales)
          const d2 = r.dispatch3Qty ?? 0; // dispatch3 = tomorrow's dispatch
          const d3 = 0; // 3rd dispatch day not in current calculate response
          const deficit = Math.max(0, d1 - stock);
          return {
            recipeId: r.recipeId,
            recipeName: r.recipeName,
            color: r.color ?? null,
            packsPerBatch: r.packsPerBatch ?? 5,
            leftOverStock: Math.round(stock),
            salesNextDay: d1,
            salesNextDayPlus1: d2,
            salesNextDayPlus2: d3,
            neededForDispatch: deficit,
            extraToMake: defaultExtra,
            toMakePacks: deficit + d2 + d3 + defaultExtra,
            toMakeBatches: 0,
          };
        });

        const allMacRecipes = [...mapped, ...missingRecipes];

        // Fetch extra-to-make defaults from settings
        Promise.all(
          allMacRecipes.map(r =>
            fetch(`/api/app-settings/mac_cheese_extra_packs_${r.recipeId}`, { credentials: "include" })
              .then(resp => resp.ok ? resp.json() : null)
              .then(d => ({ id: r.recipeId, value: d?.value ? Number(d.value) : (isThursday ? 0 : 5) }))
              .catch(() => ({ id: r.recipeId, value: isThursday ? 0 : 5 }))
          )
        ).then(extraResults => {
          const overrides: Record<number, number> = {};
          for (const e of extraResults) overrides[e.id] = e.value;
          setExtraOverrides(overrides);
          setRecipes(allMacRecipes);
          setLoading(false);
        });
      })
      .catch(() => setLoading(false));
  }, [planDate]);

  const getToMake = (r: MacCheeseCalcRecipe) => {
    const extra = extraOverrides[r.recipeId] ?? r.extraToMake;
    return r.neededForDispatch + r.salesNextDayPlus1 + r.salesNextDayPlus2 + extra;
  };

  const handleSubmit = async () => {
    const items = recipes
      .map(r => ({ recipeId: r.recipeId, packsToMake: getToMake(r) }))
      .filter(i => i.packsToMake > 0);
    if (items.length === 0) return;
    setSaving(true);
    try {
      const resp = await fetch(`/api/production-plans/${planId}/add-mac-cheese`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ items }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Failed to add");
      toast({ title: "Mac cheese added", description: `Added ${items.length} recipe(s) to the plan.` });
      onSuccess();
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Calculating…
      </div>
    );
  }

  if (recipes.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="font-medium">No Macaroni Cheese recipes found.</p>
        <p className="text-sm mt-1">Add recipes with category "Macaroni Cheese" first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wider">
              <th className="pb-2 pr-3">Recipe</th>
              <th className="pb-2 px-2 text-right">Stock</th>
              <th className="pb-2 px-2 text-right">Sales D1</th>
              <th className="pb-2 px-2 text-right">Deficit</th>
              <th className="pb-2 px-2 text-right">Sales D2</th>
              <th className="pb-2 px-2 text-right">Sales D3</th>
              <th className="pb-2 px-2 text-right">Extra</th>
              <th className="pb-2 px-2 text-right font-semibold">To Make</th>
              <th className="pb-2 pl-2 text-right">Batches</th>
            </tr>
          </thead>
          <tbody>
            {recipes.map(r => {
              const extra = extraOverrides[r.recipeId] ?? r.extraToMake;
              const toMake = getToMake(r);
              const batches = r.packsPerBatch > 0 ? Math.ceil(toMake / r.packsPerBatch) : 0;
              return (
                <tr key={r.recipeId} className="border-b border-border/50">
                  <td className="py-2.5 pr-3 font-medium">
                    <div className="flex items-center gap-2">
                      {r.color && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} />}
                      {r.recipeName}
                    </div>
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{r.leftOverStock}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{r.salesNextDay}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums text-amber-600">{r.neededForDispatch}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{r.salesNextDayPlus1}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{r.salesNextDayPlus2}</td>
                  <td className="py-2.5 px-2 text-right">
                    <input
                      type="number"
                      min={0}
                      value={extra}
                      onChange={e => setExtraOverrides(prev => ({ ...prev, [r.recipeId]: Math.max(0, Number(e.target.value) || 0) }))}
                      className="w-16 px-2 py-1 text-right bg-background border border-border rounded text-sm tabular-nums"
                    />
                  </td>
                  <td className="py-2.5 px-2 text-right font-bold tabular-nums text-lg">{toMake}</td>
                  <td className="py-2.5 pl-2 text-right tabular-nums text-muted-foreground">{batches}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="pt-3">Total</td>
              <td colSpan={6} />
              <td className="pt-3 px-2 text-right tabular-nums text-lg">{recipes.reduce((s, r) => s + getToMake(r), 0)} packs</td>
              <td className="pt-3 pl-2 text-right tabular-nums">
                {recipes.reduce((s, r) => {
                  const toMake = getToMake(r);
                  return s + (r.packsPerBatch > 0 ? Math.ceil(toMake / r.packsPerBatch) : 0);
                }, 0)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Stock = current fridge packs. Sales D1/D2/D3 = next 3 dispatch days from Shopify. Deficit = max(0, D1 - Stock). Extra = additional packs. All values in packs.
      </p>

      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={saving || recipes.every(r => getToMake(r) === 0)}
          className="px-5 py-2.5 bg-yellow-600 text-white rounded-lg text-sm font-medium hover:bg-yellow-700 disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add to Plan
        </button>
      </div>
    </div>
  );
}

export function MacaroniCheeseStation({ plan, isOnBreak = false }: { plan: ProductionPlanDetail; isOnBreak?: boolean }) {
  const { state: authState } = useAuth();
  const queryClient = useQueryClient();
  const createBatchCompletion = useCreateBatchCompletion();
  const authUser = authState.status === "authenticated" ? authState.user : null;

  // Filter to mac cheese items only
  const macItems = (plan.items ?? []).filter(it => isMacCheese(it as any));
  const { ingredients, loading: prepLoading } = useMacCheesePrep(plan.id, macItems);

  const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(new Set());
  const [completing, setCompleting] = useState<number | null>(null);

  // Temperature recording
  const [tempRecords, setTempRecords] = useState<TempRecord[]>([]);
  const [tempInputs, setTempInputs] = useState<Record<string, string>>({});
  const [tempSaving, setTempSaving] = useState(false);
  const [runTempAction] = useGuardedAction();

  // Load existing temp records
  useEffect(() => {
    fetch(`/api/temperature-records?planId=${plan.id}`, { credentials: "include" })
      .then(r => r.json())
      .then(records => {
        const macRecords = (records ?? []).filter((r: any) =>
          r.recordType === "mac_sauce_pre_cheese" || r.recordType === "mac_sauce_post_cheese"
        );
        setTempRecords(macRecords);
      })
      .catch(() => {});
  }, [plan.id]);

  const handleRecordTemp = async (recordType: string, label: string) => {
    const value = tempInputs[recordType];
    const c = parseFloat(value);
    if (isNaN(c)) { toast({ title: "Enter a valid temperature", variant: "destructive" }); return; }
    setTempSaving(true);
    try {
      await runTempAction(async (signal) => {
        const resp = await guardedFetch(`/api/temperature-records`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planId: plan.id,
            planName: plan.name,
            trayIndex: 0,
            temperatureC: c,
            recordType,
          }),
          signal,
        });
        const record = await resp.json();
        setTempRecords(prev => [...prev, record]);
        setTempInputs(prev => ({ ...prev, [recordType]: "" }));
        toast({ title: "Temperature recorded", description: `${c}°C saved for ${label}` });
      });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
    setTempSaving(false);
  };

  const handleBatchComplete = async (itemId: number) => {
    setCompleting(itemId);
    try {
      await createBatchCompletion.mutateAsync({
        planId: plan.id,
        data: {
          planItemId: itemId,
          stationType: "macaroni_cheese",
          userId: authUser?.id,
          userName: authUser?.name ?? undefined,
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      toast({ title: "Batch complete" });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
    setCompleting(null);
  };

  const pastaIngredients = ingredients.filter(i => i.section === "pasta");
  const sauceIngredients = ingredients.filter(i => i.section === "sauce");
  const toppingIngredients = ingredients.filter(i => i.section === "topping");

  const totalPacks = macItems.reduce((s, it) => {
    const ppb = (it.portionsPerBatch ?? 10) / (it.packSize ?? 2);
    return s + (it.batchesTarget ?? 0) * ppb;
  }, 0);

  const preCheeseRecords = tempRecords.filter(r => r.recordType === "mac_sauce_pre_cheese");
  const postCheeseRecords = tempRecords.filter(r => r.recordType === "mac_sauce_post_cheese");

  if (macItems.length === 0) {
    return (
      <div className="space-y-6">
        <div className="bg-card border border-yellow-200 dark:border-yellow-800 rounded-xl p-5">
          <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
            <UtensilsCrossed className="w-5 h-5 text-yellow-600" />
            Add Macaroni Cheese to this Plan
          </h2>
          <InlineAddMacCheese
            planId={plan.id}
            planDate={plan.planDate}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
              queryClient.invalidateQueries({ queryKey: getListProductionPlansQueryKey() });
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <UtensilsCrossed className="w-5 h-5 text-yellow-600" />
            Macaroni Cheese
          </h2>
          <span className="text-sm font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-3 py-1 rounded-full">
            {Math.round(totalPacks)} packs total
          </span>
        </div>

        {/* Recipe breakdown */}
        <div className="space-y-2">
          {macItems.map(item => {
            const done = getStationCount(item, "macaroni_cheese");
            const target = item.batchesTarget ?? 0;
            const packs = target * ((item.portionsPerBatch ?? 10) / (item.packSize ?? 2));
            const isComplete = done >= target;
            return (
              <div key={item.id} className={cn("flex items-center justify-between p-3 rounded-lg border", isComplete ? "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200" : "bg-background border-border")}>
                <div className="flex items-center gap-3">
                  {item.recipeColor && <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.recipeColor ?? undefined }} />}
                  <div>
                    <span className="font-medium">{item.recipeName}</span>
                    <span className="text-xs text-muted-foreground ml-2">{Math.round(packs)} packs</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn("text-sm font-mono tabular-nums", isComplete ? "text-emerald-600" : "")}>
                    {done}/{target} batches
                  </span>
                  {!isComplete && (
                    <button
                      onClick={() => handleBatchComplete(item.id)}
                      disabled={completing === item.id || isOnBreak}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-600 text-white rounded-lg text-sm font-medium hover:bg-yellow-700 disabled:opacity-50"
                    >
                      {completing === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Batch Done
                    </button>
                  )}
                  {isComplete && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Prep Sections */}
      {prepLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading prep requirements…
        </div>
      ) : (
        <>
          {/* Pasta Prep */}
          {pastaIngredients.length > 0 && (
            <IngredientSection
              title="Pasta Prep"
              icon={<Package className="w-4 h-4" />}
              ingredients={pastaIngredients}
              checked={checkedIngredients}
              onToggle={id => setCheckedIngredients(prev => {
                const next = new Set(prev);
                next.has(id) ? next.delete(id) : next.add(id);
                return next;
              })}
            />
          )}

          {/* Cheese Sauce */}
          {sauceIngredients.length > 0 && (
            <IngredientSection
              title="Cheese Sauce"
              icon={<ChefHat className="w-4 h-4" />}
              ingredients={sauceIngredients}
              checked={checkedIngredients}
              onToggle={id => setCheckedIngredients(prev => {
                const next = new Set(prev);
                next.has(id) ? next.delete(id) : next.add(id);
                return next;
              })}
            />
          )}

          {/* Topping */}
          {toppingIngredients.length > 0 && (
            <IngredientSection
              title="Topping"
              icon={<UtensilsCrossed className="w-4 h-4" />}
              ingredients={toppingIngredients}
              checked={checkedIngredients}
              onToggle={id => setCheckedIngredients(prev => {
                const next = new Set(prev);
                next.has(id) ? next.delete(id) : next.add(id);
                return next;
              })}
            />
          )}
        </>
      )}

      {/* Temperature Records */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold text-sm flex items-center gap-2 mb-4">
          <Thermometer className="w-4 h-4 text-red-500" />
          Cheese Sauce Temperature Record
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Check 1: 75°C prior to adding cheese. Check 2: 75°C after adding and melting cheese.
        </p>

        <div className="space-y-4">
          {/* Check 1: Pre-cheese */}
          <TempCheckRow
            label="Check 1 — Before adding cheese"
            targetTemp={75}
            recordType="mac_sauce_pre_cheese"
            records={preCheeseRecords}
            inputValue={tempInputs["mac_sauce_pre_cheese"] ?? ""}
            onInputChange={v => setTempInputs(prev => ({ ...prev, mac_sauce_pre_cheese: v }))}
            onRecord={() => handleRecordTemp("mac_sauce_pre_cheese", "Check 1 (pre-cheese)")}
            saving={tempSaving}
          />

          {/* Check 2: Post-cheese */}
          <TempCheckRow
            label="Check 2 — After melting cheese"
            targetTemp={75}
            recordType="mac_sauce_post_cheese"
            records={postCheeseRecords}
            inputValue={tempInputs["mac_sauce_post_cheese"] ?? ""}
            onInputChange={v => setTempInputs(prev => ({ ...prev, mac_sauce_post_cheese: v }))}
            onRecord={() => handleRecordTemp("mac_sauce_post_cheese", "Check 2 (post-cheese)")}
            saving={tempSaving}
          />
        </div>
      </div>
    </div>
  );
}

function IngredientSection({ title, icon, ingredients, checked, onToggle }: {
  title: string;
  icon: React.ReactNode;
  ingredients: PrepIngredient[];
  checked: Set<string>;
  onToggle: (id: string) => void;
}) {
  const allChecked = ingredients.every(i => checked.has(`${i.ingredientId}`));
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className={cn("px-4 py-3 border-b border-border flex items-center gap-2", allChecked && "bg-emerald-50 dark:bg-emerald-900/10")}>
        {icon}
        <h3 className="font-semibold text-sm">{title}</h3>
        {allChecked && <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto" />}
      </div>
      <div className="divide-y divide-border/50">
        {ingredients.map(ing => {
          const key = `${ing.ingredientId}`;
          const isDone = checked.has(key);
          return (
            <button
              key={key}
              onClick={() => onToggle(key)}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 text-left transition-colors",
                isDone ? "bg-emerald-50/50 dark:bg-emerald-900/5" : "hover:bg-muted/30",
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                  isDone ? "bg-emerald-500 border-emerald-500" : "border-border",
                )}>
                  {isDone && <Check className="w-3.5 h-3.5 text-white" />}
                </div>
                <span className={cn("text-sm font-medium", isDone && "line-through text-muted-foreground")}>{ing.ingredientName}</span>
              </div>
              <span className="text-sm tabular-nums font-mono text-muted-foreground">{formatQty(ing.totalQty, ing.unit)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TempCheckRow({ label, targetTemp, recordType, records, inputValue, onInputChange, onRecord, saving }: {
  label: string;
  targetTemp: number;
  recordType: string;
  records: TempRecord[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onRecord: () => void;
  saving: boolean;
}) {
  const hasRecord = records.length > 0;
  const lastRecord = records[records.length - 1];
  const lastTemp = lastRecord ? Number(lastRecord.temperatureC) : null;
  const isAboveTarget = lastTemp !== null && lastTemp >= targetTemp;

  return (
    <div className={cn(
      "p-3 rounded-lg border",
      hasRecord && isAboveTarget ? "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200" :
      hasRecord && !isAboveTarget ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200" :
      "border-border",
    )}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{label}</span>
        {hasRecord && (
          <span className={cn("text-sm font-bold", isAboveTarget ? "text-emerald-600" : "text-amber-600")}>
            {lastTemp}°C {isAboveTarget ? "✓" : `(target: ${targetTemp}°C)`}
          </span>
        )}
      </div>
      {hasRecord ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          Recorded at {new Date(lastRecord.recordedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          {lastRecord.userName && <span>by {lastRecord.userName}</span>}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.1"
            value={inputValue}
            onChange={e => onInputChange(e.target.value)}
            placeholder={`${targetTemp}°C`}
            className="w-24 px-3 py-1.5 bg-background border border-border rounded text-sm"
          />
          <button
            onClick={onRecord}
            disabled={saving || !inputValue}
            className="px-3 py-1.5 bg-red-500 text-white rounded text-sm font-medium hover:bg-red-600 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Thermometer className="w-3.5 h-3.5" />}
            Record
          </button>
        </div>
      )}
    </div>
  );
}
