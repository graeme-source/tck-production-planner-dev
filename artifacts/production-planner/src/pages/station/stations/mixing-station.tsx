import React from "react";
import { useState, useEffect, useCallback } from "react";
import {
  useUpdateProductionPlanOrder,
  getGetProductionPlanQueryKey,
} from "@workspace/api-client-react";
import type { ProductionPlanDetail, ProductionPlanItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import {
  ChevronUp, Plus, Minus, Check, CheckCircle2, PlayCircle, Loader2,
  GripVertical, Lock, RotateCcw, Package, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BreakTracker } from "../shared/break-tracker";
import { getStationCount } from "../shared/constants";
import { toKg } from "../shared/prep-helpers";
import type { PrepRecipeDetail } from "./prep-hub";


// ──────────────────────────────────────────────────────────────────────────────
// Mixing & Cooking Station
// ──────────────────────────────────────────────────────────────────────────────

function formatMixQty(qty: number, unit: string | null) {
  if (qty >= 1000 && (unit === "g" || unit === "ml")) {
    return `${(qty / 1000).toFixed(3)} ${unit === "g" ? "kg" : "L"}`;
  }
  if (unit === "kg") return `${qty.toFixed(3)} kg`;
  if (unit === "l" || unit === "L") return `${qty.toFixed(3)} L`;
  if (unit === "g") return `${qty.toFixed(0)} g`;
  if (unit === "ml") return `${qty.toFixed(0)} ml`;
  return `${qty % 1 === 0 ? qty : qty.toFixed(3)} ${unit ?? ""}`;
}

interface FillingMixItem {
  itemId: number;
  recipeId: number;
  recipeName: string | null;
  tinSize: string | null;
  tinsTarget: number;
  batchesPerTin: number;
  servingsPerTin: number;
  fillingIngredients: Array<{ ingredientId: number; name: string | null; unit: string | null; qtyPerBatch: number; qtyPerTin: number; mixingOverage?: number }>;
  fillingSubRecipes: Array<{ subRecipeId: number; name: string | null; unit: string | null; qtyPerBatch: number; qtyPerTin: number; mixingOverage?: number }>;
}

interface MixingStationProps {
  plan: ProductionPlanDetail;
}

export function MixingStation({ plan, isOnBreak = false }: MixingStationProps & { isOnBreak?: boolean }) {
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";
  const queryClient = useQueryClient();
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [checkedIngredients, setCheckedIngredients] = useState<Record<string, boolean>>({});
  const [completing, setCompleting] = useState(false);
  const [completeFailed, setCompleteFailed] = useState(false);

  const authUser = state.status === "authenticated" ? state.user : null;

  const [mixingTab, setMixingTab] = useState<"tins" | "cooking">("cooking");
  // key = `${recipeId}-${ingredientId}`, value = map of trayIdx → 0 (empty), 1 (in oven), 2 (done)
  const [trayStates, setTrayStates] = useState<Record<string, Record<number, 0 | 1 | 2>>>({});
  // key = `${recipeId}-${ingredientId}`, value = map of trayIdx → pack count (1 or 2, default 2)
  const [trayPacks, setTrayPacks] = useState<Record<string, Record<number, 1 | 2>>>({});
  interface OvenEventRow {
    id: number; planId: number; recipeId: number | null; recipeName: string | null;
    ingredientId: number | null; ingredientName: string | null; trayIndex: number;
    ovenInAt: string; ovenOutAt: string | null; userId: number | null; userName: string | null;
  }
  const [ovenEvents, setOvenEvents] = useState<OvenEventRow[]>([]);
  // Pending temperature entry: which tray just moved to "done" and needs a temp recorded
  const [tempPrompt, setTempPrompt] = useState<{
    recipeId: number; recipeName: string;
    ingredientId: number; ingredientName: string;
    trayIdx: number; planId: number; planName: string;
  } | null>(null);
  const [tempValue, setTempValue] = useState("");
  const [tempSaving, setTempSaving] = useState(false);

  useEffect(() => {
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    fetch(`${base}/api/oven-events?planId=${plan.id}`, { credentials: "include" })
      .then(r => r.json())
      .then((rows: OvenEventRow[]) => {
        setOvenEvents(rows);
        const restored: Record<string, Record<number, 0 | 1 | 2>> = {};
        for (const ev of rows) {
          const key = `${ev.recipeId}-${ev.ingredientId}`;
          if (!restored[key]) restored[key] = {};
          restored[key][ev.trayIndex] = ev.ovenOutAt ? 2 : 1;
        }
        setTrayStates(prev => {
          const merged = { ...prev };
          for (const [k, v] of Object.entries(restored)) {
            merged[k] = { ...(merged[k] ?? {}), ...v };
          }
          return merged;
        });
      })
      .catch((err) => { console.warn("[MixingStation] Oven events fetch failed:", err); });
  }, [plan.id]);

  const [runTrayAction, trayBusy] = useGuardedAction();
  const [trayPending, setTrayPending] = useState<string | null>(null);

  const advanceTray = async (
    recipeId: number, recipeName: string,
    ingredientId: number, ingredientName: string,
    trayIdx: number, planId: number, planName: string,
  ) => {
    const pendingKey = `${recipeId}-${ingredientId}-${trayIdx}`;
    if (trayPending === pendingKey) return;
    setTrayPending(pendingKey);
    const key = `${recipeId}-${ingredientId}`;
    const cur = (trayStates[key]?.[trayIdx] ?? 0) as 0 | 1 | 2;
    let next: 0 | 1 | 2;
    if (cur === 0) next = 1;
    else if (cur === 1) next = 2;
    else next = 0;

    setTrayStates(prev => ({ ...prev, [key]: { ...prev[key], [trayIdx]: next } }));

    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    try {
      if (next === 1) {
        const res = await guardedFetch(`${base}/api/oven-events/oven-in`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId, recipeId, recipeName, ingredientId, ingredientName, trayIndex: trayIdx }),
        });
        const ev: OvenEventRow = await res.json();
        setOvenEvents(prev => [ev, ...prev]);
      } else if (next === 2) {
        const res = await guardedFetch(`${base}/api/oven-events/oven-out`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId, recipeId, ingredientId, trayIndex: trayIdx }),
        });
        const ev: OvenEventRow = await res.json();
        setOvenEvents(prev => prev.map(e => e.id === ev.id ? ev : e));
        setTimeout(() => setTempPrompt({ recipeId, recipeName, ingredientId, ingredientName, trayIdx, planId, planName }), 0);
      } else {
        await guardedFetch(`${base}/api/oven-events?planId=${planId}&recipeId=${recipeId}&ingredientId=${ingredientId}&trayIndex=${trayIdx}`, {
          method: "DELETE",
        });
        setOvenEvents(prev => prev.filter(e => !(e.recipeId === recipeId && e.ingredientId === ingredientId && e.trayIndex === trayIdx)));
      }
    } catch (err) {
      console.warn("[MixingStation] Tray advance failed, reverting:", err);
      setTrayStates(prev => ({ ...prev, [key]: { ...prev[key], [trayIdx]: cur } }));
    } finally {
      setTrayPending(null);
    }
  };

  // Toggle pack count for a tray between 1 and 2 (default 2)
  const togglePacks = (key: string, trayIdx: number) => {
    setTrayPacks(prev => {
      const cur = prev[key]?.[trayIdx] ?? 2;
      return { ...prev, [key]: { ...prev[key], [trayIdx]: cur === 2 ? 1 : 2 } };
    });
  };

  const [runTempAction, tempSavingBusy] = useGuardedAction();

  const submitTemp = async () => {
    if (!tempPrompt) return;
    const c = parseFloat(tempValue);
    if (isNaN(c)) return;
    setTempSaving(true);
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    await runTempAction(async (signal) => {
      await guardedFetch(`${base}/api/temperature-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: tempPrompt.planId,
          planName: tempPrompt.planName,
          recipeId: tempPrompt.recipeId,
          recipeName: tempPrompt.recipeName,
          ingredientId: tempPrompt.ingredientId,
          ingredientName: tempPrompt.ingredientName,
          trayIndex: tempPrompt.trayIdx,
          temperatureC: c,
          recordType: "cooked_core",
        }),
        signal,
      });
      toast({ title: "Temperature recorded", description: `${c}°C saved for tray ${tempPrompt.trayIdx + 1}` });
    });
    setTempSaving(false);
    setTempPrompt(null);
    setTempValue("");
  };
  const [cookingRecipes, setCookingRecipes] = useState<PrepRecipeDetail[]>([]);
  useEffect(() => {
    fetch(`/api/production-plans/${plan.id}/prep-requirements-by-recipe?station=prep_meat`, { credentials: "include" })
      .then(r => r.json())
      .then((d: { recipes?: PrepRecipeDetail[] }) => setCookingRecipes(d.recipes ?? []))
      .catch((err) => { console.warn("[MixingStation] Cooking recipes fetch failed:", err); });
    const interval = setInterval(() => {
      fetch(`/api/production-plans/${plan.id}/prep-requirements-by-recipe?station=prep_meat`, { credentials: "include" })
        .then(r => r.json())
        .then((d: { recipes?: PrepRecipeDetail[] }) => setCookingRecipes(d.recipes ?? []))
        .catch((err) => { console.warn("[MixingStation] Cooking recipes poll failed:", err); });
    }, 10000);
    return () => clearInterval(interval);
  }, [plan.id]);

  const [fillingData, setFillingData] = useState<FillingMixItem[]>([]);
  useEffect(() => {
    fetch(`/api/production-plans/${plan.id}/filling-mix`, { credentials: "include" })
      .then(r => r.json())
      .then(d => setFillingData(d.items ?? []))
      .catch((err) => { console.warn("[MixingStation] Filling data fetch failed:", err); });
  }, [plan.id]);

  const updateOrder = useUpdateProductionPlanOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      },
    },
  });

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // A recipe is locked in place once the building station has started it
  // (first batch completed by builders). Locked recipes always stay at the top.
  const isBuildingStarted = (it: ProductionPlanItem) => getStationCount(it, "building") > 0;
  const isOrderLocked = (it: ProductionPlanItem) => isBuildingStarted(it) || it.status === "complete";

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex(it => it.id === active.id);
    const newIndex = items.findIndex(it => it.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const movingItem = items[oldIndex];

    if (isOrderLocked(movingItem)) return;
    const lockedCount = items.filter(isOrderLocked).length;
    if (newIndex < lockedCount) {
      toast({ title: "Can't reorder", description: "Recipes already in production are fixed at the top.", variant: "destructive" });
      return;
    }

    const reordered = arrayMove(items, oldIndex, newIndex);
    const order = reordered.map((it, i) => ({ itemId: it.id, orderPosition: i + 1 }));
    updateOrder.mutate(
      { id: plan.id, data: { order } },
      {
        onSuccess: () => toast({ title: "Order saved", description: "Recipe order has been updated for all stations." }),
        onError: () => toast({ title: "Reorder failed", description: "Could not save the new order. Please try again.", variant: "destructive" }),
      }
    );
  };

  // Matches server-side calcTinCount: min 2 tins when batches > 5
  const calcTins = (batchesTarget: number, maxBpt: number | null) => {
    if (!maxBpt || batchesTarget <= 0) return 1;
    const raw = Math.ceil(batchesTarget / maxBpt);
    return batchesTarget > 5 ? Math.max(2, raw) : raw;
  };

  const getTinInfo = (item: ProductionPlanItem) => {
    const bpt = item.maxBatchesPerTin ?? 1;
    const target = item.batchesTarget ?? 0;
    const mixed = getStationCount(item, "mixing");
    const tinsTarget = item.mixingTinOverride ?? calcTins(target, bpt);
    const batchesPerTinEven = tinsTarget > 0 ? Math.ceil(target / tinsTarget) : target;
    const tinsComplete = tinsTarget > 0 ? Math.min(Math.floor(mixed / batchesPerTinEven), tinsTarget) : 0;
    if (mixed >= target && target > 0) {
      return { tinsTarget, tinsComplete: tinsTarget, batchesPerTinEven, mixed, target, allDone: true };
    }
    return { tinsTarget, tinsComplete, batchesPerTinEven, mixed, target, allDone: false };
  };

  const [runTinAction, tinPending] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
  });

  const addTin = async (item: ProductionPlanItem): Promise<boolean> => {
    if (isOnBreak) return false;
    const { tinsComplete, batchesPerTinEven, mixed, target, allDone } = getTinInfo(item);
    if (allDone) return false;
    const batchesAfterNextTin = Math.min((tinsComplete + 1) * batchesPerTinEven, target);
    const batchesToAdd = batchesAfterNextTin - mixed;
    if (batchesToAdd <= 0) return false;
    const result = await runTinAction(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/batch-completions/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType: "mixing", count: batchesToAdd }),
        signal,
      });
      return true;
    });
    return result ?? false;
  };

  const undoTin = async (item: ProductionPlanItem) => {
    if (isOnBreak) return;
    const { tinsComplete, batchesPerTinEven, mixed } = getTinInfo(item);
    if (tinsComplete === 0 && mixed === 0) return;
    const prevTinThreshold = Math.max((tinsComplete - 1) * batchesPerTinEven, 0);
    const batchesToRemove = mixed - prevTinThreshold;
    if (batchesToRemove <= 0) return;
    await runTinAction(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/batch-completions/bulk`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType: "mixing", count: batchesToRemove }),
        signal,
      });
    });
  };

  const getFillingForItem = (itemId: number) => fillingData.find(f => f.itemId === itemId);

  const toggleIngredient = (itemId: number, key: string) => {
    setCheckedIngredients(prev => ({ ...prev, [`${itemId}-${key}`]: !prev[`${itemId}-${key}`] }));
  };

  const allCheckedForItem = (item: ProductionPlanItem) => {
    const filling = getFillingForItem(item.id);
    if (!filling) return false;
    const total = filling.fillingIngredients.length + filling.fillingSubRecipes.length;
    if (total === 0) return false;
    for (let i = 0; i < filling.fillingIngredients.length; i++) {
      if (!checkedIngredients[`${item.id}-ing-${i}`]) return false;
    }
    for (let i = 0; i < filling.fillingSubRecipes.length; i++) {
      if (!checkedIngredients[`${item.id}-sub-${i}`]) return false;
    }
    return true;
  };

  const clearChecksForItem = (itemId: number) => {
    setCheckedIngredients(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${itemId}-`)) delete next[key];
      }
      return next;
    });
  };

  const handleAutoComplete = useCallback(async (item: ProductionPlanItem) => {
    if (completing || isOnBreak) return;
    setCompleting(true);
    setCompleteFailed(false);
    const success = await addTin(item);
    if (success) {
      clearChecksForItem(item.id);
      const info = getTinInfo(item);
      const newTinsComplete = info.tinsComplete + 1;
      if (newTinsComplete >= info.tinsTarget) {
        const currentIdx = items.findIndex(it => it.id === item.id);
        const nextItem = items.slice(currentIdx + 1).find(it => {
          const f = getFillingForItem(it.id);
          const mc = getStationCount(it, "mixing");
          const tgt = it.batchesTarget ?? 0;
          return f && (f.fillingIngredients.length > 0 || f.fillingSubRecipes.length > 0) && mc < tgt;
        });
        setActiveItemId(nextItem ? nextItem.id : null);
      }
    } else {
      setCompleteFailed(true);
    }
    setCompleting(false);
  }, [completing, isOnBreak, items, fillingData]);

  useEffect(() => {
    if (activeItemId === null) return;
    const item = items.find(it => it.id === activeItemId);
    if (!item) return;
    if (allCheckedForItem(item) && !completing && !isOnBreak) {
      handleAutoComplete(item);
    }
  }, [checkedIngredients, activeItemId]);

  const activateItem = (itemId: number) => {
    setActiveItemId(prev => (prev === itemId ? null : itemId));
  };

  const activeItem = activeItemId ? items.find(it => it.id === activeItemId) : null;
  const activeFilling = activeItemId ? getFillingForItem(activeItemId) : null;
  const activeHasFilling = activeFilling && (activeFilling.fillingIngredients.length > 0 || activeFilling.fillingSubRecipes.length > 0);

  const totalTinsTarget = items.reduce((s, it) => s + getTinInfo(it).tinsTarget, 0);
  const totalTinsComplete = items.reduce((s, it) => s + getTinInfo(it).tinsComplete, 0);
  const totalBatchesDone = items.reduce((s, it) => s + getStationCount(it, "mixing"), 0);
  const totalBatchesTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const overallProgress = totalTinsTarget > 0 ? Math.round((totalTinsComplete / totalTinsTarget) * 100) : 0;


  const getActiveTinInfo = () => {
    if (!activeItem) return { tinsTarget: 0, tinsComplete: 0, batchesPerTinEven: 0, currentTinBatches: 0, isComplete: false };
    const target = activeItem.batchesTarget ?? 0;
    const bpt = activeItem.maxBatchesPerTin ?? 1;
    const mixingCount = getStationCount(activeItem, "mixing");
    const tinsTarget = activeItem.mixingTinOverride ?? calcTins(target, bpt);
    const batchesPerTinEven = tinsTarget > 0 ? Math.ceil(target / tinsTarget) : target;
    let tinsComplete = tinsTarget > 0 ? Math.min(Math.floor(mixingCount / batchesPerTinEven), tinsTarget) : 0;
    if (mixingCount >= target && target > 0) tinsComplete = tinsTarget;
    const allDone = tinsComplete >= tinsTarget;
    const isComplete = mixingCount >= target && target > 0;
    const currentTinBatches = (() => {
      if (allDone || tinsTarget === 0) return batchesPerTinEven;
      const batchesAfterNextTin = Math.min((tinsComplete + 1) * batchesPerTinEven, target);
      return batchesAfterNextTin - mixingCount;
    })();
    return { tinsTarget, tinsComplete, batchesPerTinEven, currentTinBatches, isComplete };
  };

  const activeTinInfo = getActiveTinInfo();

  return (
    <>
    {/* Temperature entry dialog */}
    {tempPrompt && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
          <div>
            <h3 className="font-bold text-lg">Record Core Temperature</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {tempPrompt.recipeName} — {tempPrompt.ingredientName}, Tray {tempPrompt.trayIdx + 1}
            </p>
            {authUser && <p className="text-xs text-muted-foreground">Recorded by: {authUser.name}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Core Temperature (°C)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                min="0"
                max="200"
                placeholder="e.g. 75.5"
                value={tempValue}
                onChange={e => setTempValue(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") submitTemp(); }}
                autoFocus
                className="flex-1 border border-border rounded-lg px-3 py-2.5 text-lg font-semibold tabular-nums bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <span className="text-xl font-bold text-muted-foreground">°C</span>
            </div>
            {tempValue && !isNaN(parseFloat(tempValue)) && (
              <p className={cn("text-sm font-semibold", parseFloat(tempValue) >= 75 ? "text-green-600" : "text-red-600")}>
                {parseFloat(tempValue) >= 75 ? "✓ Above 75°C — safe" : "⚠️ Below 75°C minimum — check again"}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => { setTempPrompt(null); setTempValue(""); }}
              className="flex-1 py-2.5 rounded-xl border border-border font-medium text-sm hover:bg-secondary"
            >
              Skip
            </button>
            <button
              onClick={submitTemp}
              disabled={!tempValue || isNaN(parseFloat(tempValue)) || tempSaving}
              className="flex-1 py-2.5 rounded-xl bg-green-600 text-white font-semibold text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {tempSaving ? "Saving…" : "Save Temperature"}
            </button>
          </div>
        </div>
      </div>
    )}
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="font-semibold text-lg">Today's Production</h2>
            <p className="text-base text-muted-foreground">
              {totalTinsComplete} of {totalTinsTarget} tins complete · {totalBatchesDone} / {totalBatchesTarget} batches
            </p>
          </div>
          <span className="text-3xl font-bold font-display">{overallProgress}%</span>
        </div>
        <div className="w-full h-3 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              overallProgress >= 100 ? "bg-emerald-500" : "bg-primary"
            )}
            style={{ width: `${Math.min(overallProgress, 100)}%` }}
          />
        </div>

      </div>

      {/* ── Big tab switcher ── */}
      <div className="flex gap-2">
        <button
          onClick={() => setMixingTab("cooking")}
          className={cn(
            "flex-1 py-4 rounded-xl font-bold text-xl transition-all border-2 bg-card",
            mixingTab === "cooking"
              ? "border-rose-500 text-rose-600 dark:text-rose-400"
              : "border-border text-muted-foreground hover:border-rose-400/60 hover:text-foreground"
          )}
        >
          Meat Cooking
        </button>
        <button
          onClick={() => setMixingTab("tins")}
          className={cn(
            "flex-1 py-4 rounded-xl font-bold text-xl transition-all border-2 bg-card",
            mixingTab === "tins"
              ? "border-primary text-primary"
              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
          )}
        >
          Mixing Tins
        </button>
      </div>

      {/* ── Cooking tab ── */}
      {mixingTab === "cooking" && (
        <div className="space-y-4">
          {cookingRecipes.filter(r => r.trayCount != null && r.trayCount > 0).length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-6 text-center text-muted-foreground text-sm">
              No raw meat trays for this plan — cooking settings not yet configured on ingredients.
            </div>
          ) : (
            cookingRecipes
              .filter(r => r.trayCount != null && r.trayCount > 0)
              .map(recipe => {
                const rawMeatIngs = recipe.ingredients.filter(i => i.isRawMeat && i.trayCount != null && i.trayCount > 0);
                const marinades = recipe.marinades ?? [];
                const totalDoneForRecipe = rawMeatIngs.reduce((s, ing) => {
                  const key = `${recipe.recipeId}-${ing.ingredientId}`;
                  return s + Object.values(trayStates[key] ?? {}).filter(st => st === 2).length;
                }, 0);
                const totalTraysForRecipe = rawMeatIngs.reduce((s, ing) => s + (ing.trayCount ?? 0), 0);
                const recipeAllDone = totalTraysForRecipe > 0 && totalDoneForRecipe >= totalTraysForRecipe;
                return (
                  <div key={recipe.recipeId} className={cn("bg-card border-2 rounded-xl overflow-hidden transition-all", recipeAllDone ? "border-green-400 dark:border-green-600" : "border-border")}>
                    {/* Recipe header */}
                    <div className={cn("flex items-center justify-between px-4 py-3 border-b border-border", recipeAllDone ? "bg-green-50 dark:bg-green-900/20" : "bg-secondary/30")}>
                      <div>
                        <p className="font-semibold text-lg">{recipe.recipeName}</p>
                        <div className="flex items-baseline gap-2 mt-0.5">
                          <span className="text-sm text-muted-foreground">{recipe.batchesTarget} batches</span>
                          <span className="text-xl font-extrabold tabular-nums leading-none">
                            {totalTraysForRecipe}
                            <span className="text-sm font-semibold text-muted-foreground ml-0.5">tray{totalTraysForRecipe !== 1 ? "s" : ""}</span>
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        {recipeAllDone ? (
                          <span className="text-green-600 dark:text-green-400 font-bold text-base">✓ All done</span>
                        ) : (
                          <div className="flex items-baseline gap-0.5 justify-end">
                            <span className="text-2xl font-extrabold tabular-nums leading-none">{totalDoneForRecipe}</span>
                            <span className="text-sm font-semibold text-muted-foreground tabular-nums">/{totalTraysForRecipe}</span>
                            <span className="text-xs text-muted-foreground ml-1">done</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Per-meat-ingredient sections */}
                    <div className="divide-y divide-border/50">
                      {rawMeatIngs.map(ing => {
                        const ingTrays = ing.trayCount ?? 0;
                        const key = `${recipe.recipeId}-${ing.ingredientId}`;
                        const ingTrayMap = trayStates[key] ?? {};
                        const doneCount = Object.values(ingTrayMap).filter(s => s === 2).length;
                        const inOvenCount = Object.values(ingTrayMap).filter(s => s === 1).length;
                        const allIngDone = doneCount >= ingTrays;
                        const perTrayKg = ingTrays > 0 ? toKg(ing.rawQty, ing.unit) / ingTrays : null;

                        return (
                          <div key={ing.ingredientId} className="px-4 py-4 space-y-3">
                            {/* Ingredient name + weight info */}
                            <div className="flex items-center justify-between">
                              <div>
                                <p className={cn("font-semibold text-lg", allIngDone && "line-through text-muted-foreground")}>{ing.ingredientName}</p>
                                {perTrayKg && (
                                  <p className="text-sm text-muted-foreground tabular-nums">
                                    {perTrayKg.toFixed(3)} kg / tray · {toKg(ing.rawQty, ing.unit).toFixed(3)} kg total
                                  </p>
                                )}
                              </div>
                              {inOvenCount > 0 && (
                                <p className="text-sm font-semibold text-orange-600 dark:text-orange-400">{inOvenCount} in oven</p>
                              )}
                            </div>

                            {/* Tray grid with inline tray count label */}
                            <div className="flex items-center gap-3">
                              {/* Tray count label */}
                              <div className="flex-shrink-0 flex flex-col items-center justify-center w-10">
                                <span className={cn(
                                  "text-2xl font-extrabold tabular-nums leading-none",
                                  allIngDone ? "text-green-600 dark:text-green-400" : "text-foreground"
                                )}>{ingTrays}</span>
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide leading-tight mt-0.5">
                                  {ingTrays === 1 ? "tray" : "trays"}
                                </span>
                              </div>
                              {/* Tray buttons */}
                              <div className="flex-1 grid grid-cols-4 gap-2">
                                {Array.from({ length: ingTrays }, (_, idx) => {
                                  const st = ingTrayMap[idx] ?? 0;
                                  const packs = trayPacks[key]?.[idx] ?? 2;
                                  const isFull = packs === 2;
                                  return (
                                    <div key={idx} className="flex flex-col rounded-xl overflow-hidden border-2 transition-all active:scale-95"
                                      style={{
                                        borderColor: st === 2 ? (isFull ? "#22c55e" : "#22c55e")
                                          : st === 1 ? "#f97316"
                                          : isFull ? "var(--border)" : "#fcd34d",
                                      }}
                                    >
                                      {/* Top — state: tap to advance empty → in oven → done */}
                                      <button
                                        onClick={() => advanceTray(recipe.recipeId, recipe.recipeName, ing.ingredientId, ing.ingredientName, idx, plan.id, plan.name ?? "")}
                                        disabled={trayPending === `${recipe.recipeId}-${ing.ingredientId}-${idx}`}
                                        className={cn(
                                          "flex flex-col items-center justify-center py-3 font-semibold text-base w-full disabled:opacity-50 disabled:pointer-events-none",
                                          st === 2 ? "bg-green-500 text-white"
                                          : st === 1 ? "bg-orange-500 text-white"
                                          : "bg-card text-muted-foreground hover:text-foreground"
                                        )}
                                      >
                                        <span className="text-lg leading-none">{st === 2 ? "✓" : st === 1 ? "🔥" : idx + 1}</span>
                                        <span className="text-xs opacity-80 mt-0.5">{st === 2 ? "done" : st === 1 ? "in oven" : "tray"}</span>
                                      </button>
                                      {/* Bottom — pack count: tap to toggle 1 ↔ 2 */}
                                      <button
                                        onClick={() => togglePacks(key, idx)}
                                        className={cn(
                                          "w-full flex items-center justify-center py-1.5 text-xs font-bold border-t transition-colors",
                                          packs === 1
                                            ? st === 2 ? "bg-green-400/50 border-green-400 text-green-900 dark:text-green-100"
                                              : st === 1 ? "bg-orange-400/40 border-orange-300 text-orange-900 dark:text-orange-100"
                                              : "bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300"
                                            : "bg-secondary/40 border-border/40 text-muted-foreground"
                                        )}
                                        title="Tap to toggle pack count"
                                      >
                                        ×{packs}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
          )}

          {(() => {
            const completed = ovenEvents.filter(e => e.ovenOutAt);
            if (completed.length === 0) return null;
            return (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-secondary/30">
                  <p className="font-semibold text-lg">Cooking Times</p>
                  <p className="text-sm text-muted-foreground">Actual oven times recorded today</p>
                </div>
                <div className="divide-y divide-border/50">
                  {completed.map(ev => {
                    const inTime = new Date(ev.ovenInAt);
                    const outTime = new Date(ev.ovenOutAt!);
                    const durationMin = Math.round((outTime.getTime() - inTime.getTime()) / 60000);
                    const hours = Math.floor(durationMin / 60);
                    const mins = durationMin % 60;
                    const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                    const formatTime = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                    return (
                      <div key={ev.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-base truncate">{ev.recipeName}</p>
                          <p className="text-sm text-muted-foreground truncate">
                            {ev.ingredientName} — Tray {ev.trayIndex + 1}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-base tabular-nums">{durationStr}</p>
                          <p className="text-sm text-muted-foreground tabular-nums">
                            {formatTime(inTime)} → {formatTime(outTime)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {mixingTab === "tins" && (
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2 px-1">
          {activeItemId ? "All Recipes" : "Click a recipe to start mixing"}
        </h3>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map(it => it.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {items.map(item => {
                const mixingCount = getStationCount(item, "mixing");
                const target = item.batchesTarget ?? 0;
                const bpt = item.maxBatchesPerTin ?? 1;
                const tinsTarget = item.mixingTinOverride ?? calcTins(target, bpt);
                const batchesPerTinEven = tinsTarget > 0 ? Math.ceil(target / tinsTarget) : target;
                let tinsComplete = tinsTarget > 0 ? Math.min(Math.floor(mixingCount / batchesPerTinEven), tinsTarget) : 0;
                if (mixingCount >= target && target > 0) tinsComplete = tinsTarget;
                const allTinsDone = tinsComplete >= tinsTarget;
                const progress = tinsTarget > 0 ? Math.round((tinsComplete / tinsTarget) * 100) : 0;
                const isComplete = mixingCount >= target && target > 0;
                const filling = getFillingForItem(item.id);
                const hasFillingItems = filling && (filling.fillingIngredients.length > 0 || filling.fillingSubRecipes.length > 0);
                const isActive = activeItemId === item.id;
                const isDraggable = !isOrderLocked(item);

                return (
                  <MixingOverviewRow
                    key={item.id}
                    item={item}
                    isActive={isActive}
                    isComplete={isComplete}
                    isDraggable={isDraggable}
                    hasFillingItems={!!hasFillingItems}
                    tinsComplete={tinsComplete}
                    tinsTarget={tinsTarget}
                    allTinsDone={allTinsDone}
                    progress={progress}
                    mixingCount={mixingCount}
                    target={target}
                    batchesPerTinEven={batchesPerTinEven}
                    isOnBreak={isOnBreak}
                    isAdmin={isAdmin}
                    onActivate={() => activateItem(item.id)}
                    onAdd={() => addTin(item)}
                    onRemove={() => undoTin(item)}
                    tinPending={tinPending}
                    filling={filling ?? null}
                    checkedIngredients={checkedIngredients}
                    onToggleIngredient={(key) => toggleIngredient(item.id, key)}
                    completing={isActive && completing}
                    completeFailed={isActive && completeFailed}
                    onAutoComplete={() => handleAutoComplete(item)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>
      )}
    </div>
    </>
  );
}

interface MixingOverviewRowProps {
  item: ProductionPlanItem;
  isActive: boolean;
  isComplete: boolean;
  isDraggable: boolean;
  hasFillingItems: boolean;
  tinsComplete: number;
  tinsTarget: number;
  allTinsDone: boolean;
  progress: number;
  mixingCount: number;
  target: number;
  batchesPerTinEven: number;
  isOnBreak: boolean;
  isAdmin: boolean;
  onActivate: () => void;
  onAdd: () => void;
  onRemove: () => void;
  tinPending: boolean;
  filling: FillingMixItem | null;
  checkedIngredients: Record<string, boolean>;
  onToggleIngredient: (key: string) => void;
  completing: boolean;
  completeFailed: boolean;
  onAutoComplete: () => void;
}

function MixingOverviewRow({ item, isActive, isComplete, isDraggable, hasFillingItems, tinsComplete, tinsTarget, allTinsDone, progress, mixingCount, target, batchesPerTinEven, isOnBreak, isAdmin, onActivate, onAdd, onRemove, tinPending, filling, checkedIngredients, onToggleIngredient, completing, completeFailed, onAutoComplete }: MixingOverviewRowProps) {
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: item.id, disabled: !isDraggable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : "auto",
  };

  const currentTinBatches = (() => {
    const allDone = tinsComplete >= tinsTarget;
    if (allDone || tinsTarget === 0) return batchesPerTinEven;
    const batchesAfterNextTin = Math.min((tinsComplete + 1) * batchesPerTinEven, target);
    return batchesAfterNextTin - mixingCount;
  })();

  const batchesPerTinEqual = tinsTarget > 0 ? target / tinsTarget : currentTinBatches;

  const statusColors = {
    pending: "border-border",
    "in-progress": "border-blue-300 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-900/10",
    complete: "border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-900/10",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "bg-card border rounded-xl overflow-hidden transition-colors",
        isActive ? "border-primary ring-1 ring-primary/30" : statusColors[item.status as keyof typeof statusColors] ?? "border-border",
        isDragging && "shadow-xl"
      )}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center gap-0.5 flex-shrink-0 pt-1">
            <span className="text-sm font-mono text-muted-foreground w-6 text-center leading-tight">
              {item.orderPosition}
            </span>
            {isDraggable ? (
              <div
                {...attributes}
                {...listeners}
                className="p-1 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
                title="Drag to reorder"
              >
                <GripVertical className="w-4 h-4" />
              </div>
            ) : (
              <div
                className="p-1 text-amber-500 dark:text-amber-400"
                title="Locked — building has started, position is fixed"
              >
                <Lock className="w-3.5 h-3.5" />
              </div>
            )}
          </div>

          <div
            className={cn("flex-1 min-w-0", hasFillingItems ? "cursor-pointer" : "")}
            onClick={hasFillingItems ? onActivate : undefined}
          >
            <div className="flex items-center gap-2 mb-1">
              <h3 className={cn("font-semibold text-lg", isComplete ? "line-through text-muted-foreground" : "")}>
                {item.recipeName ?? `Recipe #${item.recipeId}`}
              </h3>
              {isComplete && <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />}
              {item.status === "in-progress" && !isComplete && <PlayCircle className="w-5 h-5 text-blue-500 flex-shrink-0" />}
              {isActive && <ChevronUp className="w-5 h-5 text-primary flex-shrink-0" />}
            </div>

            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", isComplete ? "bg-emerald-500" : "bg-primary")}
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
              {item.tinSize && <span>{item.tinSize}</span>}

              <span>{mixingCount} / {target} batches total</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onRemove}
              disabled={tinsComplete === 0 || isOnBreak || tinPending}
              className="w-11 h-11 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
            >
              <Minus className="w-5 h-5" />
            </button>
            <div className="w-16 text-center">
              <span className="text-2xl font-bold">{tinsComplete}</span>
              <span className="text-sm text-muted-foreground block leading-tight">/ {tinsTarget} tin{tinsTarget !== 1 ? "s" : ""}</span>
            </div>
            <button
              onClick={onAdd}
              disabled={(allTinsDone && !isAdmin) || isOnBreak || tinPending}
              className={cn(
                "w-11 h-11 flex items-center justify-center rounded-full transition-colors",
                isOnBreak
                  ? "border border-amber-300 bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 opacity-60"
                  : allTinsDone
                    ? "border border-emerald-300 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 opacity-60"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {isActive && hasFillingItems && filling && (
        <div className="border-t border-primary/20 bg-primary/5">
          <div className="px-4 py-2 flex items-center justify-between">
            <p className="text-sm font-medium text-primary">
              Filling Mix — Tin {tinsComplete + 1} of {tinsTarget}
            </p>
          </div>
          <div className="px-4 pb-3 space-y-0.5">
            {filling.fillingIngredients.map((fi, idx) => (
              <div key={`ing-${idx}`} className="flex items-center gap-3 py-2 px-3 rounded-lg">
                <div className="flex-1">
                  <span className="text-lg">{fi.name ?? `Ingredient #${fi.ingredientId}`}</span>
                  {(fi.mixingOverage ?? 0) > 0 && (
                    <span className="ml-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-1.5 py-0.5">
                      +{formatMixQty(fi.mixingOverage!, fi.unit)} extra total
                    </span>
                  )}
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-lg font-mono tabular-nums font-bold text-foreground">
                    {formatMixQty(fi.qtyPerTin, fi.unit)}
                  </span>
                  <span className="text-sm text-muted-foreground leading-none mt-0.5">per tin</span>
                </div>
              </div>
            ))}
            {filling.fillingSubRecipes.map((fs, idx) => (
              <div key={`sub-${idx}`} className="flex items-center gap-3 py-2 px-3 rounded-lg">
                <div className="flex-1">
                  <span className="text-lg">{fs.name ?? `Sub-recipe #${fs.subRecipeId}`}</span>
                  {(fs.mixingOverage ?? 0) > 0 && (
                    <span className="ml-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-1.5 py-0.5">
                      +{formatMixQty(fs.mixingOverage!, fs.unit)} extra total
                    </span>
                  )}
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-lg font-mono tabular-nums font-bold text-foreground">
                    {formatMixQty(fs.qtyPerTin, fs.unit)}
                  </span>
                  <span className="text-sm text-muted-foreground leading-none mt-0.5">per tin</span>
                </div>
              </div>
            ))}
          </div>

          {!completing && !completeFailed && (
            <div className="px-4 pb-3">
              <button
                onClick={onAutoComplete}
                className="w-full py-3.5 rounded-lg bg-emerald-600 text-white font-bold text-base hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
              >
                <Check className="w-5 h-5" />
                Complete Tin {tinsComplete + 1}
              </button>
            </div>
          )}

          {completing && (
            <div className="px-4 pb-3">
              <div className="w-full py-2.5 rounded-lg bg-emerald-600/80 text-white font-semibold text-sm flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Completing tin...
              </div>
            </div>
          )}

          {completeFailed && !completing && (
            <div className="px-4 pb-3">
              <button
                onClick={onAutoComplete}
                className="w-full py-2.5 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Retry — Complete Tin {tinsComplete + 1}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Extra Pack Control — secondary control on Building station
// ──────────────────────────────────────────────────────────────────────────────
export function ExtraPackControl({ planId, item, isOnBreak }: { planId: number; item: ProductionPlanItem; isOnBreak: boolean }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const extraPacks = item.extraPacksBuilt ?? 0;
  const portionsPerBatch = item.portionsPerBatch ?? 0;

  const adjustExtraPacks = async (delta: 1 | -1) => {
    if (pending || isOnBreak) return;
    if (delta === -1 && extraPacks <= 0) return;
    setPending(true);
    try {
      const res = await fetch(`/api/production-plans/${planId}/items/${item.id}/extra-packs-built`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(planId) });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Could not update extra packs.", variant: "destructive" });
    } finally {
      setPending(false);
    }
  };

  const totalBatchEquiv = portionsPerBatch > 0
    ? ((item.batchesTarget ?? 0) + extraPacks / portionsPerBatch).toFixed(1)
    : null;

  return (
    <div className="mt-3 border border-dashed border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4" />
          <span>Extra Single Packs</span>
          {extraPacks > 0 && (
            <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-xs font-semibold px-2 py-0.5 rounded-full">
              +{extraPacks} pack{extraPacks !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <ChevronRight className={cn("w-4 h-4 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-dashed border-border bg-secondary/10">
          <p className="text-xs text-muted-foreground mb-3">
            Record individual packs built from extra sheeted balls — filling that doesn't make a full batch.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => adjustExtraPacks(-1)}
              disabled={pending || isOnBreak || extraPacks <= 0}
              className="w-10 h-10 flex items-center justify-center rounded-xl border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-all"
            >
              <Minus className="w-4 h-4" />
            </button>
            <div className="flex-1 text-center">
              <p className="text-2xl font-bold tabular-nums">{extraPacks}</p>
              <p className="text-xs text-muted-foreground">extra packs</p>
              {totalBatchEquiv && extraPacks > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">≈ {totalBatchEquiv} batches total</p>
              )}
            </div>
            <button
              onClick={() => adjustExtraPacks(1)}
              disabled={pending || isOnBreak}
              className={cn(
                "h-10 px-4 rounded-xl text-sm font-bold transition-all",
                isOnBreak
                  ? "bg-secondary text-muted-foreground"
                  : "bg-amber-500 text-white hover:bg-amber-600 active:scale-95"
              )}
            >
              + 1 Pack
            </button>
          </div>
        </div>
      )}
    </div>
  );
}