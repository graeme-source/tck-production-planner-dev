import React, { useState, useEffect, useCallback } from "react";
import { useCreateBatchCompletion, getGetProductionPlanQueryKey } from "@workspace/api-client-react";
import type { ProductionPlanDetail, ProductionPlanItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Plus, Minus, CheckCircle2, Check, Thermometer, Clock,
  UtensilsCrossed, ChefHat, Package,
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
      <div className="text-center py-16 text-muted-foreground">
        <UtensilsCrossed className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p className="font-medium">No Macaroni Cheese items in this plan.</p>
        <p className="text-sm mt-1">Add Macaroni Cheese recipes to the plan to see them here.</p>
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
