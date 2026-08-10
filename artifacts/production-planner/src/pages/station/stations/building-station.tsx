import React, { useState, useEffect, useRef, useCallback } from "react";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import {
  useCreateBatchCompletion,
  useUpdateProductionPlanItem,
  useListTimingStandards,
  useGetStationKpi,
  useMarkBuildingFinished,
  useUnmarkBuildingFinished,
  getGetProductionPlanQueryKey,
  getGetStationKpiQueryKey,
  getGetStationActivityQueryKey,
  useGetStationActivity,
  useListBatchCompletions,
} from "@workspace/api-client-react";
import type { ProductionPlanDetail, ProductionPlanItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import {
  Plus, Minus, CheckCircle2, Loader2, ChevronRight, RotateCcw,
  BarChart2, BookOpen, Target, Scale, GripVertical, Check, ExternalLink,
  ClipboardList, CheckSquare, Square, AlertCircle, Eye, X, AlertTriangle,
  ChevronDown, Snowflake, Pencil,
} from "lucide-react";
import { format, parseISO, differenceInMinutes } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useBuildTimerConfig } from "@/hooks/use-build-timer-config";
import { useBatchBuildTimer } from "@/hooks/use-batch-build-timer";
import { ShopifyConfirmDialog } from "@/components/shopify-confirm-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
// ExtraPackControl removed — replaced by inline PackAdjustment
import { BreakTracker } from "../shared/break-tracker";
import { KpiBar } from "../shared/kpi-bar";
import { getStationCount, getAvailableFromPrev, isMacCheese, compareItemsForDisplay } from "../shared/constants";
import { packsPerBatch } from "../shared/recipe-completion";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function SortableAssemblyRow({
  id,
  ai,
  checked,
  locked,
  showHandle,
  onToggle,
}: {
  id: string;
  ai: { name: string; unit: string; weightPerBatch: number; weightHalfBatch: number; isTopping?: boolean };
  checked: boolean;
  locked: boolean;
  showHandle: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative" as const,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center">
      {showHandle && (
        <button
          type="button"
          className="flex-shrink-0 px-1 py-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-grab active:cursor-grabbing touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-5 h-5" />
        </button>
      )}
      <button
        type="button"
        onClick={onToggle}
        disabled={locked}
        className={cn(
          "flex-1 flex items-center gap-3 px-3 py-3 text-left transition-colors",
          !locked && "active:bg-slate-200 dark:active:bg-slate-700"
        )}
      >
        {locked || checked
          ? <CheckSquare className="w-6 h-6 text-emerald-500 flex-shrink-0" />
          : <Square className="w-6 h-6 text-slate-400 flex-shrink-0" />}
        <span className="text-2xl font-bold flex-1 leading-tight">{ai.name}</span>
        {ai.isTopping
          ? <span className="text-2xl font-bold font-mono flex-shrink-0 text-slate-500 dark:text-slate-400">Sprinkle</span>
          : <span className="text-2xl font-bold font-mono tabular-nums flex-shrink-0">{Math.round(ai.weightPerBatch)}g/<span className="text-slate-500 dark:text-slate-400">{Math.round(ai.weightHalfBatch)}g</span></span>
        }
      </button>
    </div>
  );
}

function SortableFillingRow({
  id,
  weightPerBatch,
  weightHalfBatch,
  checked,
  locked,
  showHandle,
  onToggle,
}: {
  id: string;
  weightPerBatch: number;
  weightHalfBatch: number;
  checked: boolean;
  locked: boolean;
  showHandle: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative" as const,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center">
      {showHandle && (
        <button
          type="button"
          className="flex-shrink-0 px-1 py-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-grab active:cursor-grabbing touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-5 h-5" />
        </button>
      )}
      <button
        type="button"
        onClick={onToggle}
        disabled={locked}
        className={cn(
          "flex-1 flex items-center gap-3 px-3 py-3 text-left transition-colors",
          !locked && "active:bg-slate-200 dark:active:bg-slate-700"
        )}
      >
        {locked || checked
          ? <CheckSquare className="w-6 h-6 text-emerald-500 flex-shrink-0" />
          : <Square className="w-6 h-6 text-slate-400 flex-shrink-0" />}
        <span className="text-2xl font-bold text-blue-700 dark:text-blue-400 flex-1 leading-tight">Filling</span>
        <span className="text-2xl font-bold font-mono tabular-nums flex-shrink-0">{Math.round(weightPerBatch)}g/<span className="text-slate-500 dark:text-slate-400">{Math.round(weightHalfBatch)}g</span></span>
      </button>
    </div>
  );
}

type AssemblyItemData = { name: string; unit: string; weightPerBatch: number; weightHalfBatch: number; sourceType: "ingredient" | "sub_recipe"; sourceId: number; assemblyOrder: number | null; isTopping?: boolean };
type AssemblyData = { itemId: number; recipeId: number; fillingWeightPerBatch: number; fillingWeightHalfBatch: number; fillingAssemblyOrder: number; assemblyItems: AssemblyItemData[]; postOvenItems?: AssemblyItemData[] };

function ChecklistItems({
  asm, hasFilling, isLocked, checkedItems, toggleCheck, dndSensors, onDragEnd,
}: {
  asm: AssemblyData;
  hasFilling: boolean;
  isLocked: boolean;
  checkedItems: Record<string, boolean>;
  toggleCheck: (key: string) => void;
  dndSensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
}) {
  // Build unified list: assembly items with filling inserted at its saved position
  type Entry = { key: string; isFilling: boolean; ai?: AssemblyItemData };
  const allItems: Entry[] = [];
  asm.assemblyItems.forEach((ai, i) => allItems.push({ key: `${ai.sourceType}-${ai.sourceId}-${i}`, isFilling: false, ai }));
  if (hasFilling) {
    const pos = Math.min(asm.fillingAssemblyOrder ?? 0, allItems.length);
    allItems.splice(pos, 0, { key: "filling", isFilling: true });
  }

  // Drag-and-drop reorder is always available to all builders, regardless of
  // whether the checklist has been marked "Ready" (isLocked). Locked state still
  // disables the checkbox toggles via the `locked` prop below.
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={allItems.map(a => a.key)} strategy={verticalListSortingStrategy}>
          {allItems.map((entry) => {
            if (entry.isFilling) {
              return (
                <SortableFillingRow
                  key="filling"
                  id="filling"
                  weightPerBatch={asm.fillingWeightPerBatch}
                  weightHalfBatch={asm.fillingWeightHalfBatch}
                  checked={!!checkedItems["filling"]}
                  locked={isLocked}
                  showHandle={true}
                  onToggle={() => toggleCheck("filling")}
                />
              );
            }
            return (
              <SortableAssemblyRow
                key={entry.key}
                id={entry.key}
                ai={entry.ai!}
                checked={!!checkedItems[entry.key]}
                locked={isLocked}
                showHandle={true}
                onToggle={() => toggleCheck(entry.key)}
              />
            );
          })}
        </SortableContext>
      </DndContext>
    </div>
  );
}

/** Read-only assembly list for viewing non-current recipes */
function ReadOnlyAssemblyList({ asm }: { asm: AssemblyData }) {
  const hasFilling = asm.fillingWeightPerBatch > 0;
  const hasItems = asm.assemblyItems.length > 0;
  if (!hasFilling && !hasItems) {
    return <p className="text-sm text-muted-foreground text-center py-3">No assembly items for this recipe.</p>;
  }

  // Build unified list with filling at saved position
  type Entry = { key: string; isFilling: boolean; ai?: AssemblyItemData };
  const allItems: Entry[] = [];
  asm.assemblyItems.forEach((ai, i) => allItems.push({ key: `${ai.sourceType}-${ai.sourceId}-${i}`, isFilling: false, ai }));
  if (hasFilling) {
    const pos = Math.min(asm.fillingAssemblyOrder ?? 0, allItems.length);
    allItems.splice(pos, 0, { key: "filling", isFilling: true });
  }

  return (
    <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Assembly Items
        </span>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {allItems.map((entry) => (
          <div key={entry.key} className="flex items-center gap-3 px-3 py-3">
            <span className={cn("text-xl font-bold flex-1 leading-tight", entry.isFilling && "text-blue-700 dark:text-blue-400")}>
              {entry.isFilling ? "Filling" : entry.ai!.name}
            </span>
            {!entry.isFilling && entry.ai!.isTopping
              ? <span className="text-xl font-bold font-mono flex-shrink-0 text-slate-500 dark:text-slate-400">Sprinkle</span>
              : <span className="text-xl font-bold font-mono tabular-nums flex-shrink-0">
                  {Math.round(entry.isFilling ? asm.fillingWeightPerBatch : entry.ai!.weightPerBatch)}g/<span className="text-slate-500 dark:text-slate-400">{Math.round(entry.isFilling ? asm.fillingWeightHalfBatch : entry.ai!.weightHalfBatch)}g</span>
                </span>
            }
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Building Station (shared for building_1 and building_2)
// Unified accordion queue with expandable recipe panels
// ──────────────────────────────────────────────────────────────────────────────
interface BuildingStationProps {
  plan: ProductionPlanDetail;
  lineNumber: 1 | 2;
  isOnBreak?: boolean;
}

function formatChangeover(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function BuildingStation({ plan, lineNumber, isOnBreak: isOnBreakProp = false }: BuildingStationProps) {
  const stationType: "building_1" | "building_2" = lineNumber === 1 ? "building_1" : "building_2";
  const queryClient = useQueryClient();
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";
  const userId = state.status === "authenticated" ? state.user.id : 0;

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Session tracking
  const [sessionStartedAt] = useState<Date>(() => new Date());
  const [sessionBatches, setSessionBatches] = useState(0);
  const [totalBreakMinutes, setTotalBreakMinutes] = useState(0);
  const [activeBreakMinutes, setActiveBreakMinutes] = useState(0);
  const [pendingTap, setPendingTap] = useState(false);
  const isOnBreak = isOnBreakProp;

  // Oven-settings overlay state. Shown when the builder switches between
  // dietary categories (meat ↔ vegetarian) — first meat or veg of the day,
  // and any time they swap from one profile to the other after that. Doing
  // four meat recipes in a row only prompts on the first one. Defaults
  // come from the four app_settings keys seeded with sane numbers.
  const [ovenDefaults, setOvenDefaults] = useState<{ meatTemp: number; meatTime: number; vegTemp: number; vegTime: number } | null>(null);
  const [lastConfirmedDietary, setLastConfirmedDietary] = useState<"meat" | "vegetarian" | null>(null);
  const [ovenPromptItemId, setOvenPromptItemId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/app-settings/oven_meat_temp_c", { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/app-settings/oven_meat_time_min", { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/app-settings/oven_veg_temp_c", { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/app-settings/oven_veg_time_min", { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([mt, mm, vt, vm]) => {
      if (cancelled) return;
      setOvenDefaults({
        meatTemp: Number(mt?.value ?? 220) || 220,
        meatTime: Number(mm?.value ?? 8) || 8,
        vegTemp: Number(vt?.value ?? 210) || 210,
        vegTime: Number(vm?.value ?? 7) || 7,
      });
    });
    return () => { cancelled = true; };
  }, []);

  // Accordion state
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);
  const userOverrideRef = useRef(false);

  // Load timing standards for KPI color coding
  const { data: timingStandards } = useListTimingStandards();
  const standard = (timingStandards ?? []).find((s: { stationType?: string }) => s.stationType === stationType);
  const targetBph = standard?.targetBatchesPerHour != null ? Number(standard.targetBatchesPerHour) : null;
  const minBph = standard?.minBatchesPerHour != null ? Number(standard.minBatchesPerHour) : null;

  // Server-side KPI (polled every 5s — refreshes from DB-persisted completions and breaks)
  const { data: serverKpi } = useGetStationKpi(plan.id, { stationType }, {
    query: { queryKey: getGetStationKpiQueryKey(plan.id, { stationType }), refetchInterval: 5000 },
  });

  // Build timer
  const timerConfig = useBuildTimerConfig();
  const [lastBatchAt, setLastBatchAt] = useState<Date | null>(null);

  // Changeover timer — tracks time spent ticking off checklist before first batch
  const [changeoverStartedAt, setChangeoverStartedAt] = useState<Date | null>(null);
  const [changeoverElapsedMs, setChangeoverElapsedMs] = useState<number>(0);

  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
        setSessionBatches(prev => prev + 1);
        setPendingTap(false);
        setLastBatchAt(new Date());
      },
      onError: (err: any) => {
        setPendingTap(false);
        // Refetch plan so builder sees up-to-date counts (e.g. if other builder completed the batch first)
        queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
        const msg = err?.response?.data?.error ?? err?.message ?? "Failed to record batch";
        toast({ title: "Batch not recorded", description: msg, variant: "destructive" });
      },
    },
  });

  const updateItem = useUpdateProductionPlanItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      },
    },
  });

  const [paceData, setPaceData] = useState<Record<number, number>>({});
  useEffect(() => {
    const fetchPace = async () => {
      try {
        const res = await fetch(`/api/production-plans/${plan.id}/batch-completions/pace?stationType=${stationType}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setPaceData(data.pace ?? {});
        }
      } catch (err) {
        console.warn("[BuildingStation] Failed to fetch pace data:", err);
      }
    };
    fetchPace();
    const interval = setInterval(fetchPace, 5000);
    return () => clearInterval(interval);
  }, [plan.id, stationType, sessionBatches]);

  const [assemblyMap, setAssemblyMap] = useState<Record<number, AssemblyData>>({});
  useEffect(() => {
    fetch(`/api/production-plans/${plan.id}/assembly-items`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.items) {
          const map: Record<number, AssemblyData> = {};
          for (const it of d.items) map[it.itemId] = it;
          setAssemblyMap(map);
        }
      })
      .catch((err) => { console.warn("[BuildingStation] Assembly data fetch failed:", err); });
  }, [plan.id]);

  const handleAssemblyDragEnd = useCallback(async (event: DragEndEvent, itemId: number) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setAssemblyMap(prev => {
      const asm = prev[itemId];
      if (!asm) return prev;

      type UnifiedItem = { key: string; isFilling: boolean; ai?: AssemblyItemData };
      const allItems: UnifiedItem[] = [];
      asm.assemblyItems.forEach((ai, i) => allItems.push({ key: `${ai.sourceType}-${ai.sourceId}-${i}`, isFilling: false, ai }));
      if (asm.fillingWeightPerBatch > 0) {
        const pos = Math.min(asm.fillingAssemblyOrder ?? 0, allItems.length);
        allItems.splice(pos, 0, { key: "filling", isFilling: true });
      }

      const oldIdx = allItems.findIndex(a => a.key === active.id);
      const newIdx = allItems.findIndex(a => a.key === over.id);
      if (oldIdx === -1 || newIdx === -1) return prev;
      const reordered = arrayMove(allItems, oldIdx, newIdx);

      const newAssemblyItems = reordered.filter(a => !a.isFilling).map(a => a.ai!);
      const orderItems = reordered.filter(a => !a.isFilling).map((a, i) => ({
        sourceType: a.ai!.sourceType,
        sourceId: a.ai!.sourceId,
        order: i,
      }));
      const fillingOrder = reordered.findIndex(a => a.isFilling);

      fetch(`/api/recipes/${asm.recipeId}/assembly-order`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: orderItems, fillingOrder: fillingOrder >= 0 ? fillingOrder : null }),
      })
        .then(r => {
          if (!r.ok) throw new Error("Save failed");
          toast({ title: "Assembly order saved" });
        })
        .catch((err) => {
          console.warn("[BuildingStation] Assembly order save failed:", err);
          toast({ title: "Failed to save order", variant: "destructive" });
        });
      return { ...prev, [itemId]: { ...asm, assemblyItems: newAssemblyItems, fillingAssemblyOrder: fillingOrder >= 0 ? fillingOrder : 0 } };
    });
  }, []);

  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  // Tracks which plan-item id the checkedItems state applies to. Prevents the
  // auto-lock effect from firing against stale checkedItems during the render
  // where currentItem?.id has changed but setCheckedItems({}) from the reset
  // effect hasn't been committed yet. Without this guard, shared keys like
  // "filling" from the previous recipe would pre-check the new recipe and
  // auto-lock it, bypassing changeover.
  const [checkedItemsItemId, setCheckedItemsItemId] = useState<number | null>(null);
  const [checklistLockedForItem, setChecklistLockedForItem] = useState<number | null>(null);
  const [checklistLoadedForItem, setChecklistLoadedForItem] = useState<number | null>(null);
  const prevRecipeIdRef = useRef<number | null>(null);
  // Prompt for extra packs when a recipe finishes
  const [extraPromptItemId, setExtraPromptItemId] = useState<number | null>(null);
  // Separate state for the edit-after-completion dialog so it doesn't fight
  // with the natural "batch just finished" prompt.
  const [editPromptItemId, setEditPromptItemId] = useState<number | null>(null);
  const [prevCurrentItemId, setPrevCurrentItemId] = useState<number | null>(null);
  // Tracks the plan-item id whose final batch THIS builder just completed.
  // Used to show the extra-packs prompt only to the builder who actually
  // finished the recipe — the other builder (who was on the penultimate batch)
  // moves straight to the next recipe.
  const myLastBatchItemIdRef = useRef<number | null>(null);
  // The recipe this builder is currently working on. Free navigation: the
  // builder taps any recipe (or the "Move to Next Recipe" button) to select it.
  // Targets never dictate this — a builder can build any recipe, in any order,
  // backwards and forwards, over or under target. Persisted to localStorage so
  // a refresh keeps them on the same recipe.
  const selKey = `building_selected_${plan.id}_${stationType}_${userId}`;
  const [selectedItemId, setSelectedItemIdRaw] = useState<number | null>(() => {
    try { const raw = localStorage.getItem(selKey); return raw != null && raw !== "" ? Number(raw) : null; }
    catch { return null; }
  });
  const setSelectedItemId = useCallback((id: number | null) => {
    setSelectedItemIdRaw(id);
    try {
      if (id == null) localStorage.removeItem(selKey);
      else localStorage.setItem(selKey, String(id));
    } catch { /* storage unavailable — selection still works in-memory */ }
  }, [selKey]);
  // Part-batch calculator dialog — tracks which item's calculator is open.
  const [calcOpenItemId, setCalcOpenItemId] = useState<number | null>(null);

  const checklistKey = (itemId: number) => `checklist_done_${plan.id}_${stationType}_${itemId}_${userId}`;

  function getCombinedBuildCount(it: ProductionPlanItem) {
    return getStationCount(it, "building_1") + getStationCount(it, "building_2");
  }

  // The planned target is REFERENCE ONLY — it's the "what to expect" goal shown
  // to builders. It never gates building: builders may stop short, hit it, or
  // go over freely. (Downstream stations follow the real built count via the
  // shared effectiveBatchesTarget helper, not this.)
  function getTargetRef(it: ProductionPlanItem) {
    return it.batchesTarget ?? 0;
  }

  // This builder's own loose extra packs on a recipe, independent of the other
  // builder. Falls back to zero when no row exists yet.
  function getMyProgress(it: ProductionPlanItem): { extraPacks: number } {
    const bp = (it as any).buildingProgress as Record<string, { extraPacks: number }> | undefined;
    return bp?.[stationType] ?? { extraPacks: 0 };
  }

  const items = [...(plan.items ?? [])].sort(compareItemsForDisplay);
  // Current = the selected recipe; default to the first recipe still under its
  // reference target (just a sensible starting point — the builder can tap any
  // recipe to switch). Targets never restrict which recipe is current.
  const selectedItem = selectedItemId != null ? items.find(it => it.id === selectedItemId) : null;
  const defaultItem = items.find(it => getCombinedBuildCount(it) < getTargetRef(it)) ?? items[0];
  const currentItem = selectedItem ?? defaultItem;

  const buildingCount = currentItem ? getCombinedBuildCount(currentItem) : 0;
  const targetRef = currentItem ? getTargetRef(currentItem) : 0;
  const myCount = currentItem ? getStationCount(currentItem, stationType) : 0;
  // Building is the start of the dependency chain — no mixing dependency.
  // remaining = planned batches still to build toward the reference target
  // (purely informational; building is never blocked when it reaches 0).
  const remaining = currentItem ? Math.max(0, targetRef - buildingCount) : 0;
  const allDone = items.length > 0 && items.every(it =>
    getCombinedBuildCount(it) >= getTargetRef(it)
  );

  // checklistPending is computed below but we need it here for the timer.
  // Inline the same logic to avoid forward-reference issues.
  const changeoverActive = (() => {
    if (!currentItem) return false;
    const asm = assemblyMap[currentItem.id];
    if (!asm) return false;
    if (asm.fillingWeightPerBatch === 0 && asm.assemblyItems.length === 0) return false;
    return checklistLockedForItem !== currentItem.id && changeoverStartedAt !== null;
  })();

  const buildTimer = useBatchBuildTimer({
    enabled: timerConfig.enabled === true,
    recipeId: currentItem?.recipeId ?? null,
    targetSeconds: (currentItem as { targetBuildSeconds?: number | null } | undefined)?.targetBuildSeconds ?? null,
    defaultSeconds: timerConfig.defaultSeconds,
    isOnBreak,
    lastBatchAt,
    changeoverActive,
  });

  // Checklist load
  useEffect(() => {
    if (!currentItem) return;
    if (checklistLoadedForItem === currentItem.id) return;
    fetch(`/api/app-settings/${checklistKey(currentItem.id)}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.value === "true") {
          setChecklistLockedForItem(currentItem.id);
          // Checklist already done — cancel changeover (returning builder)
          setChangeoverStartedAt(null);
        }
        setChecklistLoadedForItem(currentItem.id);
      })
      .catch((err) => { console.warn("[BuildingStation] Checklist setting fetch failed:", err); setChecklistLoadedForItem(currentItem.id); });
  }, [currentItem?.id, stationType]);

  // Reset checklist on recipe change
  useEffect(() => {
    const curId = currentItem?.id ?? null;
    if (curId === null) return;
    if (curId !== prevRecipeIdRef.current) {
      prevRecipeIdRef.current = curId;
      setCheckedItems({});
      setCheckedItemsItemId(curId);
      setChecklistLockedForItem(null);
      setChecklistLoadedForItem(null);
      // Start changeover timer for this recipe
      setChangeoverStartedAt(new Date());
      setChangeoverElapsedMs(0);
    }
  }, [currentItem?.id]);

  // Changeover tick — count up while checklist is pending
  useEffect(() => {
    if (!changeoverStartedAt || !changeoverActive || isOnBreak) return;
    const id = window.setInterval(() => {
      setChangeoverElapsedMs(Date.now() - changeoverStartedAt.getTime());
    }, 250);
    return () => window.clearInterval(id);
  }, [changeoverStartedAt, changeoverActive, isOnBreak]);

  // (No presence guard, no "active-build pin", no per-recipe locking.) The two
  // builders work fully independently: each navigates recipes freely and the
  // server never rejects a building completion. Coordination is implicit — both
  // builders' output simply adds up for the oven station.

  // Auto-lock checklist when all items checked
  useEffect(() => {
    if (!currentItem || checklistLockedForItem === currentItem.id) return;
    // Guard: skip if checkedItems hasn't been scoped to the current recipe yet
    // (i.e. we're in the transient render where currentItem.id has advanced
    // but the reset effect's setCheckedItems({}) hasn't committed).
    // Without this, shared keys like "filling" from the previous recipe would
    // pre-satisfy the auto-lock and bypass the changeover for the new recipe.
    if (checkedItemsItemId !== currentItem.id) return;
    const asm = assemblyMap[currentItem.id];
    if (!asm) return;
    const allKeys: string[] = [];
    if (asm.fillingWeightPerBatch > 0) allKeys.push("filling");
    asm.assemblyItems.forEach((a, i) => allKeys.push(`${a.sourceType}-${a.sourceId}-${i}`));
    if (allKeys.length > 0 && allKeys.every(k => checkedItems[k])) {
      setChecklistLockedForItem(currentItem.id);
      fetch(`/api/app-settings/${checklistKey(currentItem.id)}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "true" }),
      }).catch((err) => { console.warn("[BuildingStation] Checklist lock save failed:", err); });

      // Complete changeover — record duration and start batch timer
      if (changeoverStartedAt) {
        const completedAt = new Date();
        const durationMs = completedAt.getTime() - changeoverStartedAt.getTime();
        setChangeoverStartedAt(null);
        setLastBatchAt(completedAt); // arms the batch countdown timer

        // Fire-and-forget POST to record changeover
        fetch(`/api/production-plans/${plan.id}/station-changeovers`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planItemId: currentItem.id,
            stationType,
            recipeId: currentItem.recipeId,
            startedAt: changeoverStartedAt.toISOString(),
            completedAt: completedAt.toISOString(),
            durationMs,
          }),
        }).catch((err) => { console.warn("[BuildingStation] Changeover save failed:", err); });
      }
    }
  }, [checkedItems, checkedItemsItemId, currentItem?.id, assemblyMap, checklistLockedForItem]);

  // Detect recipe change — prompt for extra packs + auto-expand next
  useEffect(() => {
    const curId = currentItem?.id ?? null;
    if (prevCurrentItemId !== null && curId !== prevCurrentItemId) {
      // Only show extra packs prompt if the previous recipe is actually done
      // (not just skipped by last-batch coordination logic)
      const prevItem = items.find(it => it.id === prevCurrentItemId);
      if (prevItem && getCombinedBuildCount(prevItem) >= getTargetRef(prevItem)) {
        // Only show the prompt to the builder who actually completed the last
        // batch. The other builder (who finished the penultimate batch) should
        // move straight to the next recipe without being interrupted.
        if (myLastBatchItemIdRef.current === prevCurrentItemId) {
          setExtraPromptItemId(prevCurrentItemId);
        }
      }
      myLastBatchItemIdRef.current = null;
      setExpandedItemId(curId);
      userOverrideRef.current = false;
    }
    setPrevCurrentItemId(curId);
  }, [currentItem?.id]);

  // Initialize expanded item
  useEffect(() => {
    if (expandedItemId === null && currentItem) {
      setExpandedItemId(currentItem.id);
    }
  }, [currentItem?.id]);

  const toggleExpanded = (itemId: number) => {
    if (expandedItemId === itemId) {
      setExpandedItemId(null);
      userOverrideRef.current = false;
    } else {
      setExpandedItemId(itemId);
      userOverrideRef.current = itemId !== currentItem?.id;
    }
  };

  const extraPromptItem = extraPromptItemId != null ? items.find(it => it.id === extraPromptItemId) : null;
  const editPromptItem = editPromptItemId != null ? items.find(it => it.id === editPromptItemId) : null;

  const checklistPending = (() => {
    if (!currentItem) return false;
    const asm = assemblyMap[currentItem.id];
    if (!asm) return false;
    if (asm.fillingWeightPerBatch === 0 && asm.assemblyItems.length === 0) return false;
    return checklistLockedForItem !== currentItem.id;
  })();

  // Building is never gated by the target — a builder can record a batch on the
  // current recipe at any time (over, under, or at the reference target).
  const canRecordBatch = (_item: ProductionPlanItem) => true;

  // Post-completion bookkeeping: remember the last-batch tap so the optional
  // extra-packs prompt is shown to the builder who reached the target. Recording
  // a batch does NOT move the builder — they stay on the recipe to build more or
  // press "Move to Next Recipe" when they're done.
  const afterBatchRecorded = (completingItemId: number, wasLastBatchTap: boolean) => {
    if (wasLastBatchTap) myLastBatchItemIdRef.current = completingItemId;
  };

  const recordBatchNow = (item: typeof currentItem) => {
    if (!item || pendingTap || isOnBreak || checklistPending || !canRecordBatch(item)) return;
    setPendingTap(true);
    const completingItemId = item.id;
    const wasLastBatchTap = remaining === 1;
    createBatch.mutate(
      {
        id: plan.id,
        data: { planItemId: completingItemId, stationType, completedAt: new Date().toISOString() },
      },
      {
        onSuccess: () => afterBatchRecorded(completingItemId, wasLastBatchTap),
      },
    );
  };

  const handleBatchComplete = () => {
    if (!currentItem || pendingTap || isOnBreak || checklistPending || !canRecordBatch(currentItem)) return;
    // Oven-settings gate: prompt only when the builder is moving between
    // dietary profiles (meat ↔ vegetarian), so the oven temp / time actually
    // needs to change. Same profile back-to-back skips the prompt — four
    // meat recipes in a row only ask once. First profile of the session
    // (lastConfirmedDietary === null) always prompts.
    const dietary = (currentItem as any).dietaryCategory as "meat" | "vegetarian" | null | undefined;
    const needsOvenPrompt = !!dietary && dietary !== lastConfirmedDietary;
    if (needsOvenPrompt) {
      setOvenPromptItemId(currentItem.id);
      return;
    }
    setPendingTap(true);
    const completingItemId = currentItem.id;
    // If this tap would complete the recipe (I'm on the last batch), remember
    // it so the recipe-change effect knows to show the extra-packs prompt to
    // ME (and not the other builder who was on the penultimate batch).
    const wasLastBatchTap = remaining === 1;
    createBatch.mutate(
      {
        id: plan.id,
        data: {
          planItemId: completingItemId,
          stationType,
          completedAt: new Date().toISOString(),
        },
      },
      {
        onSuccess: () => afterBatchRecorded(completingItemId, wasLastBatchTap),
      },
    );
  };

  const [runUndo, undoPending] = useGuardedAction({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      setSessionBatches(prev => Math.max(0, prev - 1));
    },
  });

  const [runPartialComplete, partialCompletePending] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
  });

  const handlePartialBatchComplete = () => {
    if (!currentItem || pendingTap || isOnBreak || checklistPending || partialCompletePending) return;
    // This builder's OWN loose packs (not the combined item total).
    const partialPacks = getMyProgress(currentItem).extraPacks;
    if (partialPacks <= 0) return;
    const completingItemId = currentItem.id;
    const wasLastBatchTap = remaining === 1;
    runPartialComplete((signal) =>
      guardedFetch(`/api/production-plans/${plan.id}/batch-completions`, {
        method: "POST", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planItemId: completingItemId,
          stationType,
          partialPacks,
          completedAt: new Date().toISOString(),
        }),
      }).then(() => {
        afterBatchRecorded(completingItemId, wasLastBatchTap);
        setSessionBatches(prev => prev + 1);
      })
    );
  };

  // "Move to Next Recipe" — PURE NAVIGATION. It just selects the next recipe in
  // the list. It logs nothing special (every batch is already recorded to the
  // oven line as it's built), marks nothing complete, and never touches the
  // other builder. The builder can come straight back to this recipe later.
  const selectRecipe = (itemId: number) => {
    if (isOnBreak) return;
    setSelectedItemId(itemId);
    setExpandedItemId(itemId);
  };
  const moveToNextRecipe = (item: ProductionPlanItem) => {
    if (isOnBreak) return;
    const idx = items.findIndex(it => it.id === item.id);
    const next = idx >= 0 && idx < items.length - 1 ? items[idx + 1] : items[0];
    if (next) selectRecipe(next.id);
  };

  // A blast chiller tray is 10 packs. Mac cheese only. If fewer than 10 packs
  // of work are left, the button shows "Add Final N Packs" and advances the
  // remainder in one tap (same pattern the wrapping station uses for its
  // partial last stack).
  const BLAST_TRAY_SIZE = 10;
  const [runBulkBatch, bulkBatchPending] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
  });
  const blastAddCount = (item: ProductionPlanItem): number => {
    const remaining = Math.max(0, getTargetRef(item) - getCombinedBuildCount(item));
    const cap = isAdmin ? BLAST_TRAY_SIZE : Math.min(BLAST_TRAY_SIZE, remaining);
    return cap;
  };
  const blastUndoCount = (item: ProductionPlanItem): number =>
    Math.min(BLAST_TRAY_SIZE, getStationCount(item, stationType));
  const addBlastChillerTray = async (item: ProductionPlanItem) => {
    if (isOnBreak) return;
    const count = blastAddCount(item);
    if (count <= 0) return;
    await runBulkBatch(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/batch-completions/bulk`, {
        method: "POST", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType, count }),
      });
      setSessionBatches(prev => prev + count);
      toast({ title: `${count} pack${count === 1 ? "" : "s"} added to the oven queue` });
    });
  };
  const undoBlastChillerTray = async (item: ProductionPlanItem) => {
    if (isOnBreak) return;
    const count = blastUndoCount(item);
    if (count <= 0) return;
    await runBulkBatch(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/batch-completions/bulk`, {
        method: "DELETE", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType, count }),
      });
      setSessionBatches(prev => Math.max(0, prev - count));
      toast({ title: `${count} pack${count === 1 ? "" : "s"} returned to the build queue` });
    });
  };
  const handleUndo = () => {
    if (!currentItem || myCount === 0 || isOnBreak) return;
    runUndo((signal) =>
      guardedFetch(`/api/production-plans/${plan.id}/batch-completions/last`, {
        method: "DELETE",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: currentItem.id, stationType }),
      })
    );
  };

  const handleBreakChange = useCallback((breakMins: number | null) => {
    if (breakMins === null) {
      setTotalBreakMinutes(prev => prev + activeBreakMinutes);
      setActiveBreakMinutes(0);
    } else {
      setActiveBreakMinutes(breakMins);
    }
  }, [activeBreakMinutes]);

  const pct = currentItem && targetRef > 0
    ? Math.round((buildingCount / targetRef) * 100)
    : 0;

  // Split totals by product category. Calzone items are tracked as "batches";
  // mac cheese items as "packs" (1 mac batch_completion row = 1 pack because
  // portionsPerBatch=2, packsPerBatch=1).
  const calzoneItems = items.filter(it => !isMacCheese(it as any));
  const macItems = items.filter(it => isMacCheese(it as any));
  const totalBatchesTarget = calzoneItems.reduce((s, it) => s + getTargetRef(it), 0);
  const totalBatchesDone = calzoneItems.reduce((s, it) => s + getCombinedBuildCount(it), 0);
  const totalMacPacksTarget = macItems.reduce((s, it) => s + getTargetRef(it), 0);
  const totalMacPacksDone = macItems.reduce((s, it) => s + getCombinedBuildCount(it), 0);
  const combinedTarget = totalBatchesTarget + totalMacPacksTarget;
  const combinedDone = totalBatchesDone + totalMacPacksDone;
  const overallProgress = combinedTarget > 0 ? Math.round((combinedDone / combinedTarget) * 100) : 0;

  // Team and per-user BPH both come from /api/production-plans/:id/kpi
  // (polled every 5s) — the one standard calculation in the server's
  // lib/batches-per-hour. No local session maths, so what a builder sees
  // here matches Analytics and the morning meeting exactly.
  const teamBph = serverKpi?.batchesPerHour ?? 0;
  const yourBph = serverKpi?.yourBatchesPerHour ?? 0;

  // "Mark building finished" — the builder-confirmed end of the day's
  // production window. Until it's pressed the KPI clock keeps running, so
  // the number decays after the last batch; pressing it pins the finish
  // time and decides whether the lunch break gets deducted.
  const buildingFinishedAt = plan.buildingFinishedAt ?? serverKpi?.buildingFinishedAt ?? null;
  const allBuiltOut = combinedTarget > 0 && combinedDone >= combinedTarget;
  const [finishPromptDismissed, setFinishPromptDismissed] = useState(false);
  // Confirmation gate for finishing while batches are still outstanding —
  // e.g. a short day where the last flavour ran out of filling. The button is
  // always available, but mid-production it must be deliberate.
  const [confirmEarlyFinish, setConfirmEarlyFinish] = useState(false);
  const invalidateFinishState = () => {
    queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
    queryClient.invalidateQueries({ queryKey: getGetStationKpiQueryKey(plan.id, { stationType }) });
  };
  const markFinished = useMarkBuildingFinished({
    mutation: {
      onSuccess: () => {
        invalidateFinishState();
        toast({ title: "Building finished — KPI locked in. Nice work!" });
      },
      onError: () => toast({ title: "Couldn't mark building finished", variant: "destructive" }),
    },
  });
  const unmarkFinished = useUnmarkBuildingFinished({
    mutation: {
      onSuccess: () => {
        invalidateFinishState();
        setFinishPromptDismissed(true); // don't instantly re-open the prompt they just undid
        toast({ title: "Building resumed — KPI clock running again" });
      },
    },
  });
  // Blocking prompt the moment the last flavour is built (after the
  // extra-packs dialog for that recipe closes) so finishing can't be missed.
  const showFinishPrompt = allBuiltOut && !buildingFinishedAt && !extraPromptItem && !finishPromptDismissed;

  const bphColor = (bph: number) =>
    targetBph && minBph
      ? bph >= targetBph ? "text-emerald-600 dark:text-emerald-400"
        : bph >= minBph ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400"
      : "text-foreground";

  // Traffic-light pace tile — the builders' version of the packing team's
  // strip on the fulfilment screen (same look, same message style). Band
  // edges come from this station's timing standard rather than fulfilment's
  // fixed 50/55/60, so tightening the standard in Settings moves the bands.
  // The bottom band stays encouraging — builders look at this all day, and
  // the point is to lift the pace, not tell anyone off. Purple kicks in 10%
  // above target: genuinely flying, worth celebrating.
  const paceBand = (bph: number): { tile: string; label: string } | null => {
    if (!targetBph || !minBph || bph <= 0) return null;
    if (bph >= targetBph * 1.1) return { tile: "bg-purple-600 text-white animate-pulse", label: "SMASHING IT! 🔥" };
    if (bph >= targetBph) return { tile: "bg-green-600 text-white", label: "On target — keep going!" };
    if (bph >= minBph) return { tile: "bg-amber-500 text-white", label: "Almost there — push on!" };
    return { tile: "bg-red-600 text-white", label: "Every batch counts — let's go!" };
  };
  const teamBand = paceBand(serverKpi?.batchesPerHour ?? 0);

  return (
    <div className="space-y-4">
      {/* Daily progress + KPI + break buttons */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="font-semibold text-lg">Today's Production</h2>
            <p className="text-base text-muted-foreground">
              {totalBatchesDone} / {totalBatchesTarget} batches
              {totalMacPacksTarget > 0 && (
                <> · {totalMacPacksDone} / {totalMacPacksTarget} mac packs</>
              )}
              {" · Line "}{lineNumber}
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

        {/* Pace tile — behind / on pace / ahead at a glance, mirroring the
            packing strip. Hidden once building is finished (the green
            confirmation below takes over) and until BPH means something. */}
        {teamBand && !buildingFinishedAt && (
          <div
            className={cn(
              "mt-3 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 transition-colors",
              teamBand.tile,
            )}
            aria-label={`Building pace ${teamBph.toFixed(1)} batches per hour`}
          >
            <span className="text-2xl md:text-3xl font-extrabold tabular-nums leading-none">
              {teamBph.toFixed(1)}
              <span className="text-sm font-bold opacity-90 ml-1.5">batches/hr</span>
            </span>
            <span className="text-lg md:text-xl font-bold text-right leading-tight">{teamBand.label}</span>
          </div>
        )}

        {/* KPI: Team batches/hr + You batches/hr — calzone only, standard method */}
        {(teamBph > 0 || yourBph > 0) && (
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-medium">Team:</span>
              <span className={cn("text-lg font-bold tabular-nums", bphColor(teamBph))}>
                {teamBph.toFixed(1)}/hr
              </span>
            </div>
            <div className="w-px h-5 bg-border/60" />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-medium">You:</span>
              <span className={cn("text-lg font-bold tabular-nums", bphColor(yourBph))}>
                {yourBph.toFixed(1)}/hr
              </span>
            </div>
            {targetBph != null && (
              <>
                <div className="w-px h-5 bg-border/60" />
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground font-medium">Target:</span>
                  <span className="text-lg font-bold tabular-nums text-muted-foreground">{targetBph}/hr</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Building-finished button: always available so a short day can still
            be closed out. Unmissable pulsing green once everything is built;
            mid-production it's a quieter outline and asks for confirmation. */}
        {!buildingFinishedAt && (
          <button
            onClick={() => allBuiltOut ? markFinished.mutate({ id: plan.id }) : setConfirmEarlyFinish(true)}
            disabled={markFinished.isPending}
            className={cn(
              "w-full mt-3 h-16 rounded-xl font-bold text-xl flex items-center justify-center gap-3 transition-all",
              allBuiltOut
                ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg animate-pulse"
                : "border-2 border-emerald-600/60 text-emerald-700 dark:text-emerald-400 bg-background hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
            )}
          >
            {markFinished.isPending
              ? <Loader2 className="w-6 h-6 animate-spin" />
              : <CheckCircle2 className="w-7 h-7" />}
            Mark building finished
          </button>
        )}
        {buildingFinishedAt && (
          <div className="w-full mt-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-4 py-3 flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
            <span className="font-semibold text-emerald-800 dark:text-emerald-200">
              Building finished at {format(parseISO(buildingFinishedAt), "HH:mm")}
            </span>
            <button
              onClick={() => unmarkFinished.mutate({ id: plan.id })}
              disabled={unmarkFinished.isPending}
              className="ml-auto text-sm font-medium text-emerald-700 dark:text-emerald-300 underline underline-offset-2"
            >
              Undo
            </button>
          </div>
        )}

      </div>

      {/* Finish prompt — appears the moment the last flavour is built so the
          builder can't carry on without confirming the day is done. */}
      <Dialog open={showFinishPrompt} onOpenChange={(open) => { if (!open) setFinishPromptDismissed(true); }}>
        <DialogContent
          className="max-w-md mx-auto"
          onPointerDownOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <div className="text-center space-y-4 py-2">
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
            <DialogTitle className="text-2xl font-bold">That's everything built!</DialogTitle>
            <div className="rounded-xl bg-secondary/40 p-4 space-y-1 text-left">
              <div className="flex justify-between text-base">
                <span className="text-muted-foreground">Calzone batches</span>
                <span className="font-bold tabular-nums">{totalBatchesDone} / {totalBatchesTarget}</span>
              </div>
              {totalMacPacksTarget > 0 && (
                <div className="flex justify-between text-base">
                  <span className="text-muted-foreground">Mac packs</span>
                  <span className="font-bold tabular-nums">{totalMacPacksDone} / {totalMacPacksTarget}</span>
                </div>
              )}
              {teamBph > 0 && (
                <div className="flex justify-between text-base">
                  <span className="text-muted-foreground">Team batches/hr</span>
                  <span className={cn("font-bold tabular-nums", bphColor(teamBph))}>{teamBph.toFixed(1)}</span>
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Tap the button to lock in today's finish time — do this before you
              tidy up or head to lunch so the batches-per-hour stays accurate.
            </p>
            <button
              onClick={() => markFinished.mutate({ id: plan.id })}
              disabled={markFinished.isPending}
              className="w-full h-16 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xl flex items-center justify-center gap-3"
            >
              {markFinished.isPending
                ? <Loader2 className="w-6 h-6 animate-spin" />
                : <CheckCircle2 className="w-7 h-7" />}
              Mark building finished
            </button>
            <button
              onClick={() => setFinishPromptDismissed(true)}
              className="w-full h-10 text-sm text-muted-foreground underline underline-offset-2"
            >
              Not yet — still building extras
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Early-finish confirmation — the button was pressed while batches are
          still outstanding (e.g. short on the last flavour). Make sure closing
          production for the day is deliberate. */}
      <Dialog open={confirmEarlyFinish} onOpenChange={setConfirmEarlyFinish}>
        <DialogContent className="max-w-md mx-auto">
          <div className="text-center space-y-4 py-2">
            <AlertTriangle className="w-14 h-14 text-amber-500 mx-auto" />
            <DialogTitle className="text-2xl font-bold">Close production for the day?</DialogTitle>
            <div className="rounded-xl bg-secondary/40 p-4 space-y-1 text-left">
              <div className="flex justify-between text-base">
                <span className="text-muted-foreground">Calzone batches</span>
                <span className="font-bold tabular-nums">{totalBatchesDone} / {totalBatchesTarget}</span>
              </div>
              {totalMacPacksTarget > 0 && (
                <div className="flex justify-between text-base">
                  <span className="text-muted-foreground">Mac packs</span>
                  <span className="font-bold tabular-nums">{totalMacPacksDone} / {totalMacPacksTarget}</span>
                </div>
              )}
              {combinedTarget - combinedDone > 0 && (
                <div className="flex justify-between text-base">
                  <span className="text-muted-foreground">Still to build</span>
                  <span className="font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {combinedTarget - combinedDone}
                  </span>
                </div>
              )}
            </div>
            <p className="text-base text-muted-foreground">
              Not everything on the plan is built. This locks in today's finish
              time and ends building for the day.
            </p>
            <button
              onClick={() => { setConfirmEarlyFinish(false); markFinished.mutate({ id: plan.id }); }}
              disabled={markFinished.isPending}
              className="w-full h-16 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xl flex items-center justify-center gap-3"
            >
              {markFinished.isPending
                ? <Loader2 className="w-6 h-6 animate-spin" />
                : <CheckCircle2 className="w-7 h-7" />}
              Yes — close production
            </button>
            <button
              onClick={() => setConfirmEarlyFinish(false)}
              className="w-full h-12 rounded-xl border border-border text-base font-medium hover:bg-secondary"
            >
              Keep building
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Extra packs prompt — overlay dialog when a recipe just finished */}
      <Dialog open={!!extraPromptItem} onOpenChange={(open) => { if (!open) setExtraPromptItemId(null); }}>
        <DialogContent className="max-w-md mx-auto" onPointerDownOutside={e => e.preventDefault()} onEscapeKeyDown={e => e.preventDefault()}>
          {extraPromptItem && (
            <RecipeCompleteDialogBody
              planId={plan.id}
              item={extraPromptItem}
              isOnBreak={isOnBreak}
              hasFilling={(assemblyMap[extraPromptItem.id]?.fillingWeightPerBatch ?? 0) > 0}
              assemblyData={assemblyMap[extraPromptItem.id]}
              stationType={stationType}
              stationExtraPacks={getMyProgress(extraPromptItem).extraPacks}
              onDone={() => setExtraPromptItemId(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Edit dialog — reopens pack/leftover-filling entry for a completed recipe */}
      <Dialog open={!!editPromptItem} onOpenChange={(open) => { if (!open) setEditPromptItemId(null); }}>
        <DialogContent className="max-w-md mx-auto">
          {editPromptItem && (
            <RecipeCompleteDialogBody
              planId={plan.id}
              item={editPromptItem}
              isOnBreak={isOnBreak}
              hasFilling={(assemblyMap[editPromptItem.id]?.fillingWeightPerBatch ?? 0) > 0}
              assemblyData={assemblyMap[editPromptItem.id]}
              stationType={stationType}
              stationExtraPacks={getMyProgress(editPromptItem).extraPacks}
              onDone={() => setEditPromptItemId(null)}
              mode="edit"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* First-batch oven settings — confirm before recording the very first
          batch of a meat / vegetarian recipe. */}
      <Dialog open={ovenPromptItemId !== null} onOpenChange={(open) => { if (!open) setOvenPromptItemId(null); }}>
        <DialogContent className="max-w-md mx-auto" onPointerDownOutside={e => e.preventDefault()} onEscapeKeyDown={e => e.preventDefault()}>
          {(() => {
            if (ovenPromptItemId === null) return null;
            const item = items.find(it => it.id === ovenPromptItemId);
            if (!item) return null;
            const dietary = (item as any).dietaryCategory as "meat" | "vegetarian" | null;
            if (!dietary || !ovenDefaults) return null;
            const isMeat = dietary === "meat";
            const temp = isMeat ? ovenDefaults.meatTemp : ovenDefaults.vegTemp;
            const time = isMeat ? ovenDefaults.meatTime : ovenDefaults.vegTime;
            return (
              <div className="space-y-5 pt-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">First batch · check oven settings</p>
                  <h3 className="font-bold text-2xl mt-1" style={{ color: item.recipeColor || undefined }}>
                    {item.recipeName ?? `Recipe #${item.recipeId}`}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {isMeat ? "Meat" : "Vegetarian"} profile
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 text-center">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Temperature</div>
                    <div className="text-4xl font-bold tabular-nums mt-1">{temp}<span className="text-xl font-normal text-muted-foreground">°C</span></div>
                  </div>
                  <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 text-center">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Time</div>
                    <div className="text-4xl font-bold tabular-nums mt-1">{time}<span className="text-xl font-normal text-muted-foreground"> min</span></div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setLastConfirmedDietary(dietary);
                    setOvenPromptItemId(null);
                    // Record the batch right away so the same tap that
                    // confirms the oven settings also lands the build —
                    // bypassing handleBatchComplete's gate avoids the
                    // stale-closure / state-not-yet-committed re-prompt
                    // we used to hit when re-running the gate.
                    recordBatchNow(item);
                  }}
                  className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg hover:bg-primary/90 active:scale-95 transition-all"
                >
                  Checked oven settings — record batch
                </button>
                <p className="text-[11px] text-muted-foreground text-center">
                  Only shows when switching between meat and vegetarian profiles.
                </p>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Part-batch calculator — on-demand overlay for the current (or any) recipe */}
      <Dialog open={calcOpenItemId !== null} onOpenChange={(open) => { if (!open) setCalcOpenItemId(null); }}>
        <DialogContent className="max-w-md mx-auto">
          {(() => {
            if (calcOpenItemId === null) return null;
            const calcItem = items.find(it => it.id === calcOpenItemId);
            const calcAsm = calcItem ? assemblyMap[calcItem.id] : undefined;
            if (!calcItem || !calcAsm) return null;
            return (
              <div className="space-y-4 pt-2">
                <div className="flex items-start gap-3">
                  <Scale className="w-7 h-7 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-bold text-xl text-foreground">Part Batch Calculator</h3>
                    <p className="text-sm text-muted-foreground mt-1" style={{ color: calcItem.recipeColor || undefined }}>
                      {calcItem.recipeName ?? `Recipe #${calcItem.recipeId}`}
                    </p>
                  </div>
                </div>
                <BatchDivision assemblyData={calcAsm} portionsPerBatch={calcItem.portionsPerBatch ?? 10} />
                <button
                  type="button"
                  onClick={() => setCalcOpenItemId(null)}
                  className="w-full py-3 rounded-xl font-semibold text-base border border-border bg-background hover:bg-secondary/60 transition-colors"
                >
                  Close
                </button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* All recipes complete */}

      {/* Unified accordion queue */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-base">Production Queue — Line {lineNumber}</h3>
          </div>
          <div className="flex items-center gap-2">
            {allDone && (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" /> All done
              </span>
            )}
          </div>
        </div>

        <div className="divide-y divide-border/50">
          {items.map((item) => {
            const isExpanded = expandedItemId === item.id;
            const isCurrent = item.id === currentItem?.id;
            const combinedCount = getCombinedBuildCount(item);
            const effTarget = getTargetRef(item); // reference target (planned)
            const targetReached = combinedCount >= effTarget;
            const itemMyCount = getStationCount(item, stationType);
            // Informational only — how many batches are left to hit the planned
            // target. Building is NEVER blocked when this reaches 0.
            const itemRemaining = Math.max(0, effTarget - combinedCount);
            const itemPct = effTarget > 0 ? Math.round((combinedCount / effTarget) * 100) : 0;
            const asm = assemblyMap[item.id];
            const myExtraPacks = getMyProgress(item).extraPacks;
            // Loose packs ready to commit as a partial batch (this builder's own).
            const isPartialMode = myExtraPacks > 0;
            const busyWithTap = pendingTap || (isPartialMode && partialCompletePending);

            const rowHasFilling = (asm?.fillingWeightPerBatch ?? 0) > 0;
            const showEditBtn = targetReached && rowHasFilling;
            return (
              <div key={item.id}>
                {/* Collapsed summary row — toggle button + optional edit pencil as sibling */}
                <div
                  className={cn(
                    "flex items-center transition-colors",
                    isExpanded
                      ? isCurrent
                        ? "bg-primary/5"
                        : "bg-blue-50/60 dark:bg-blue-900/15"
                      : isCurrent
                        ? "bg-primary/5"
                        : targetReached
                          ? "bg-emerald-50/30 dark:bg-emerald-900/10"
                          : "hover:bg-secondary/20"
                  )}
                >
                <button
                  onClick={() => toggleExpanded(item.id)}
                  className="flex-1 text-left px-3 py-2.5 flex items-center gap-2"
                >
                  {/* Position */}
                  <span className="text-xs text-muted-foreground w-5 text-center flex-shrink-0">{item.orderPosition}</span>

                  {/* Recipe name */}
                  <span
                    className={cn(
                      "flex-1 font-bold text-sm truncate",
                      targetReached && !isExpanded ? "line-through opacity-60" : ""
                    )}
                    style={{ color: item.recipeColor || undefined }}
                  >
                    {item.recipeName ?? `Recipe #${item.recipeId}`}
                    {isCurrent && !isExpanded && <span className="text-xs text-primary ml-1">← now</span>}
                  </span>

                  {/* Stats */}
                  <span className="text-sm tabular-nums font-medium flex-shrink-0">
                    {combinedCount}/{item.batchesTarget ?? 0}
                  </span>
                  {paceData[item.id] != null && (
                    <span className="text-xs tabular-nums text-violet-600 dark:text-violet-400 font-medium flex-shrink-0">
                      {paceData[item.id]}m
                    </span>
                  )}

                  {/* Status icon */}
                  {targetReached ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <ChevronDown className={cn(
                      "w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform",
                      isExpanded ? "rotate-180" : ""
                    )} />
                  )}
                </button>
                {showEditBtn && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setEditPromptItemId(item.id); }}
                    title="Edit packs / leftover filling"
                    className="pr-3 pl-1 py-2.5 text-muted-foreground hover:text-foreground flex-shrink-0"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                </div>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className={cn(
                    "border-t-2 px-4 py-4 space-y-4",
                    isCurrent
                      ? "border-primary"
                      : "border-blue-300 dark:border-blue-700"
                  )}>
                    {/* Header: recipe name + SOP */}
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-2xl font-bold leading-tight flex-1 truncate" style={{ color: item.recipeColor || undefined }}>
                        {item.recipeName ?? `Recipe #${item.recipeId}`}
                      </h2>
                      {targetReached && (
                        <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="w-4 h-4" /> Complete
                        </span>
                      )}
                      {item.sopUrl && (
                        <a
                          href={item.sopUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg text-blue-700 dark:text-blue-300 text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors whitespace-nowrap"
                        >
                          SOP <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    {/* Two-column layout: checklist left, batch controls right (on wider screens) */}
                    {isCurrent ? (
                      <div className="flex flex-col sm:flex-row gap-3">
                        {/* LEFT — Assembly checklist + meta */}
                        <div className="sm:w-2/3 min-w-0 space-y-2">
                          {asm && (() => {
                            const hasFilling = asm.fillingWeightPerBatch > 0;
                            const hasItems = asm.assemblyItems.length > 0;
                            if (!hasFilling && !hasItems) return null;

                            const isLocked = checklistLockedForItem === item.id;
                            const toggleCheck = (key: string) => {
                              if (isLocked) return;
                              setCheckedItems(prev => ({ ...prev, [key]: !prev[key] }));
                            };

                            return (
                              <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                                <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                                  <ClipboardList className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                                  <span className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                                    {isLocked ? "Ready" : "Items needed"}
                                  </span>
                                  {isLocked && <Check className="w-4 h-4 text-emerald-500 ml-auto" />}
                                </div>
                                <ChecklistItems
                                  asm={asm}
                                  hasFilling={hasFilling}
                                  isLocked={isLocked}
                                  checkedItems={checkedItems}
                                  toggleCheck={toggleCheck}
                                  dndSensors={dndSensors}
                                  onDragEnd={(e: DragEndEvent) => handleAssemblyDragEnd(e, item.id)}
                                />
                              </div>
                            );
                          })()}

                          {/* Compact meta row */}
                          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            {item.tinSize && (
                              <span className="bg-secondary/50 rounded px-1.5 py-0.5">{item.tinSize} tin</span>
                            )}
                            {item.portionsPerBatch > 0 && (
                              <span className="bg-secondary/50 rounded px-1.5 py-0.5">{item.portionsPerBatch}/batch</span>
                            )}
                            {paceData[item.id] != null && (
                              <span className="bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 rounded px-1.5 py-0.5 font-medium">
                                {paceData[item.id]} min/batch
                              </span>
                            )}
                            {item.notes && (
                              <span className="italic">{item.notes}</span>
                            )}
                          </div>
                        </div>

                        {/* RIGHT — Batch counter + BATCH COMPLETE button */}
                        <div className="sm:w-1/3 flex flex-col items-center justify-between">
                          {/* Batch counter */}
                          <div className="text-center mb-3">
                            <p className="text-5xl font-bold font-display tabular-nums text-primary leading-none">
                              {combinedCount}
                            </p>
                            <p className="text-lg font-light text-muted-foreground">/ {effTarget}</p>
                            {item.maxBatchesPerTin && effTarget > 0 && (
                              <p className={cn("text-xs font-semibold mt-0.5", item.mixingTinOverride ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400")}>
                                {item.mixingTinOverride ?? (() => { const raw = Math.ceil(effTarget / item.maxBatchesPerTin); return effTarget > 5 ? Math.max(2, raw) : raw; })()} tins
                              </p>
                            )}
                            {itemMyCount > 0 && (
                              <p className="text-xs text-muted-foreground mt-0.5">Mine: {itemMyCount}</p>
                            )}
                          </div>

                          {/* Progress bar */}
                          <div className="w-full mb-3">
                            <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  itemPct >= 100 ? "bg-emerald-500" : "bg-primary"
                                )}
                                style={{ width: `${Math.min(itemPct, 100)}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground text-center mt-0.5">{itemRemaining} left</p>
                          </div>

                          {/* Target reached — purely informational. Building is NOT
                              blocked: the builder can keep tapping BATCH DONE to go
                              over, or press "Move to Next Recipe" when they're done. */}
                          {targetReached && (
                            <div className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-lg mb-2">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                Target reached — build more or move on
                              </p>
                            </div>
                          )}

                          {/* BATCH DONE — always available (build over/under/at target
                              freely). Swaps to PARTIAL BATCH DONE when loose packs exist. */}
                        <button
                          onClick={isPartialMode ? handlePartialBatchComplete : handleBatchComplete}
                          disabled={busyWithTap || isOnBreak || checklistPending}
                          className={cn(
                            "relative overflow-hidden w-full h-[200px] rounded-2xl text-xl sm:text-2xl font-bold transition-all select-none active:scale-95 flex flex-col items-center justify-center gap-1",
                            isOnBreak
                              ? "bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border-2 border-amber-300 cursor-not-allowed opacity-70"
                              : checklistPending
                                ? changeoverActive
                                  ? "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 border-2 border-blue-300 dark:border-blue-700 cursor-not-allowed"
                                  : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 border-2 border-slate-300 dark:border-slate-600 cursor-not-allowed opacity-70"
                                : busyWithTap
                                  ? "bg-primary/60 text-primary-foreground cursor-wait"
                                  : isPartialMode
                                    ? "bg-amber-500 text-white border-2 border-amber-600 shadow-lg hover:bg-amber-600 hover:shadow-xl"
                                    : buildTimer.alerted
                                      ? "bg-amber-500 text-white border-2 border-amber-600 shadow-lg animate-pulse"
                                      : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg hover:shadow-xl"
                          )}
                        >
                          {/* Changeover count-up timer */}
                          {timerConfig.enabled && changeoverActive && changeoverStartedAt && !allDone && (
                            <span className="text-4xl sm:text-5xl font-mono tabular-nums leading-none text-current opacity-90">
                              {formatChangeover(changeoverElapsedMs)}
                            </span>
                          )}
                          {/* Batch countdown timer */}
                          {timerConfig.enabled && buildTimer.running && !changeoverActive && !allDone && (
                            <span className={cn(
                              "text-4xl sm:text-5xl font-mono tabular-nums leading-none",
                              buildTimer.alerted ? "text-white" : "text-current opacity-90"
                            )}>
                              {buildTimer.label}
                            </span>
                          )}
                          <span>
                            {isOnBreak
                              ? "On Break"
                              : checklistPending
                                ? (changeoverActive ? "Changeover" : "Tick items ←")
                                : busyWithTap
                                  ? "Recording..."
                                  : isPartialMode
                                    ? "PARTIAL BATCH DONE ✓"
                                    : isMacCheese(item as any) ? "PACK DONE ✓" : "BATCH DONE ✓"}
                          </span>
                          {timerConfig.enabled && buildTimer.running && !allDone && !isOnBreak && (
                            <div
                              className="absolute inset-x-0 bottom-0 h-1.5 bg-black/10 overflow-hidden"
                              aria-hidden="true"
                            >
                              <div
                                className={cn(
                                  "h-full transition-all duration-200 ease-linear",
                                  buildTimer.alerted
                                    ? "bg-red-600"
                                    : buildTimer.fractionRemaining > 0.5
                                      ? "bg-emerald-400"
                                      : buildTimer.fractionRemaining > 0.2
                                        ? "bg-amber-400"
                                        : "bg-red-500"
                                )}
                                style={{ width: `${Math.round(buildTimer.fractionRemaining * 100)}%` }}
                              />
                            </div>
                          )}
                        </button>

                        {/* Snooze */}
                        {timerConfig.enabled && buildTimer.running && buildTimer.alerted && !isOnBreak && (
                          <button
                            onClick={buildTimer.snooze}
                            className="w-full py-2.5 text-sm font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50 border border-amber-300 dark:border-amber-700 rounded-lg transition-colors"
                          >
                            +1 min snooze
                          </button>
                        )}

                        {/* Blast chiller tray — mac cheese only. Advances up to 10 packs at once.
                            When fewer than 10 packs remain the button flips to "Add Final N
                            Packs" so partial trays are handled in a single tap, mirroring the
                            wrapping station's last-stack behaviour. */}
                        {isMacCheese(item as any) && !isOnBreak && (() => {
                          const blastAdd = blastAddCount(item);
                          const blastUndo = blastUndoCount(item);
                          const canBlast = blastAdd > 0 && !bulkBatchPending && !pendingTap;
                          const canUndoBlast = blastUndo > 0 && !bulkBatchPending && !pendingTap;
                          const addLabel = blastAdd >= BLAST_TRAY_SIZE
                            ? "Blast Chiller Tray (+10 packs)"
                            : blastAdd > 0
                              ? `Add Final ${blastAdd} Pack${blastAdd === 1 ? "" : "s"}`
                              : "All packs built";
                          const undoLabel = blastUndo >= BLAST_TRAY_SIZE ? "−10" : blastUndo > 0 ? `−${blastUndo}` : "−10";
                          return (
                            <div className="flex items-stretch gap-2">
                              <button
                                onClick={() => undoBlastChillerTray(item)}
                                disabled={!canUndoBlast}
                                title={canUndoBlast ? `Remove the last ${blastUndo} pack${blastUndo === 1 ? "" : "s"} advanced at this station` : "Nothing to undo at this station"}
                                className={cn(
                                  "flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold transition-colors",
                                  canUndoBlast
                                    ? "bg-cyan-50 text-cyan-700 hover:bg-cyan-100 border border-cyan-200 dark:bg-cyan-900/20 dark:text-cyan-200 dark:border-cyan-800"
                                    : "bg-cyan-50/40 text-cyan-400 border border-cyan-100 dark:bg-cyan-900/10 dark:text-cyan-500 dark:border-cyan-900 opacity-70 cursor-not-allowed",
                                )}
                              >
                                <Minus className="w-5 h-5" />
                                {undoLabel}
                              </button>
                              <button
                                onClick={() => addBlastChillerTray(item)}
                                disabled={!canBlast}
                                className={cn(
                                  "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-colors",
                                  canBlast
                                    ? "bg-cyan-600 text-white hover:bg-cyan-700"
                                    : "bg-cyan-100 text-cyan-500 dark:bg-cyan-900/20 dark:text-cyan-300 opacity-60 cursor-not-allowed",
                                )}
                              >
                                <Snowflake className="w-5 h-5" />
                                {addLabel}
                              </button>
                            </div>
                          );
                        })()}

                        {/* Undo */}
                        {combinedCount > 0 && !isOnBreak && (
                          <button
                            onClick={handleUndo}
                            disabled={pendingTap || undoPending}
                            className="w-full py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {undoPending ? "Undoing…" : "Undo"}
                          </button>
                        )}

                          {/* Pack adjustment — this builder's OWN loose packs */}
                          <PackAdjustment planId={plan.id} item={item} isOnBreak={isOnBreak} stationType={stationType} stationExtraPacks={myExtraPacks} />

                          {/* Recipe finished — an ITEM-LEVEL declaration. Once set,
                              ovens/wrapping work to the actual built count (short or
                              over), not the planned target. */}
                          <RecipeFinishedControls
                            planId={plan.id}
                            item={item}
                            combinedCount={combinedCount}
                            isOnBreak={isOnBreak}
                          />

                          {/* Move to next recipe — a PER-BUILDER action, pure
                              navigation. Advances THIS builder only; the other
                              builder can keep building on this recipe. */}
                          <MoveToNextRecipeButton
                            item={item}
                            combinedCount={combinedCount}
                            isOnBreak={isOnBreak}
                            onMoveOn={() => moveToNextRecipe(item)}
                          />

                          {/* Part-batch calculator shortcut — useful when short on packs
                              and need to prepare a partial batch before the recipe wraps up */}
                          {asm && (asm.fillingWeightPerBatch > 0 || asm.assemblyItems.length > 0) && (
                            <button
                              onClick={() => setCalcOpenItemId(item.id)}
                              disabled={isOnBreak}
                              className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold border border-border rounded-lg text-foreground hover:bg-secondary/60 disabled:opacity-40 transition-colors"
                            >
                              <Scale className="w-4 h-4" />
                              Part Batch Calculator
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                      {/* Non-current: assembly list (read-only) */}
                      {asm && <ReadOnlyAssemblyList asm={asm} />}

                      {/* Compact meta row */}
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        {item.tinSize && (
                          <span className="bg-secondary/50 rounded px-1.5 py-0.5">{item.tinSize} tin</span>
                        )}
                        {item.portionsPerBatch > 0 && (
                          <span className="bg-secondary/50 rounded px-1.5 py-0.5">{item.portionsPerBatch}/batch</span>
                        )}
                        {paceData[item.id] != null && (
                          <span className="bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 rounded px-1.5 py-0.5 font-medium">
                            {paceData[item.id]} min/batch
                          </span>
                        )}
                        {item.notes && (
                          <span className="italic">{item.notes}</span>
                        )}
                      </div>
                    </>
                    )}
                    {!isCurrent && (
                      /* Non-current recipe: show batch count + pack adjustment (editable) */
                      <div className="space-y-3">
                        <div className="border border-border rounded-xl px-3 py-2">
                          <div className="flex items-center gap-3">
                            <p className="text-sm text-muted-foreground font-semibold">
                              {isMacCheese(item as any) ? "Packs" : "Batches"}
                            </p>
                            <div className="flex items-center gap-3 ml-auto">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  runUndo((signal) =>
                                    guardedFetch(`/api/production-plans/${plan.id}/batch-completions/last`, {
                                      method: "DELETE", signal,
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ planItemId: item.id, stationType }),
                                    })
                                  );
                                }}
                                disabled={getStationCount(item, stationType) === 0 || undoPending || isOnBreak}
                                className="w-10 h-10 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                              >
                                <Minus className="w-4 h-4" />
                              </button>
                              <span className="text-xl font-bold tabular-nums min-w-[3rem] text-center">
                                {combinedCount} / {item.batchesTarget ?? 0}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Adding beyond target is a deliberate over-build — make
                                  // it an obvious, confirmed action (for everyone, not just
                                  // admins). Under target it's just a normal +1.
                                  if (combinedCount >= (item.batchesTarget ?? 0)) {
                                    const unit = isMacCheese(item as any) ? "pack" : "batch";
                                    if (!window.confirm(
                                      `Build an extra ${unit} of ${item.recipeName ?? "this recipe"} on top of the target of ${item.batchesTarget ?? 0}?`
                                    )) return;
                                  }
                                  createBatch.mutate({
                                    id: plan.id,
                                    data: { planItemId: item.id, stationType, completedAt: new Date().toISOString() },
                                  });
                                }}
                                disabled={createBatch.isPending || isOnBreak}
                                className="w-10 h-10 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 transition-colors"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                        <PackAdjustment planId={plan.id} item={item} isOnBreak={isOnBreak} stationType={stationType} stationExtraPacks={getMyProgress(item).extraPacks} />
                        {/* Free navigation — switch to this recipe to build it with
                            the full controls (checklist, BATCH DONE, packs). */}
                        {!isOnBreak && (
                          <button
                            type="button"
                            onClick={() => selectRecipe(item.id)}
                            className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold border border-primary/40 rounded-lg text-primary hover:bg-primary/10 transition-colors"
                          >
                            Switch to this recipe
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* KPI bar */}
      <KpiBar
        sessionBatches={sessionBatches}
        sessionStartedAt={sessionStartedAt}
        activeBreakMinutes={activeBreakMinutes}
        totalBreakMinutes={totalBreakMinutes}
        targetBph={targetBph}
        minBph={minBph}
        serverKpi={serverKpi}
      />
    </div>
  );
}

function RecipeCompleteDialogBody({ planId, item, isOnBreak, hasFilling, assemblyData, stationType, stationExtraPacks, onDone, mode = "complete" }: {
  planId: number;
  item: ProductionPlanItem;
  isOnBreak: boolean;
  hasFilling: boolean;
  assemblyData?: AssemblyData;
  stationType: "building_1" | "building_2";
  stationExtraPacks: number;
  onDone: () => void;
  mode?: "complete" | "edit";
}) {
  // In edit mode, prefill from the saved values on the plan item. Grams = 0 means
  // "no leftover" was confirmed; anything else is a real weight.
  const initialGrams = (item as unknown as Record<string, unknown>).leftoverFillingGrams;
  const initialComment = (item as unknown as Record<string, unknown>).leftoverFillingComment;
  const hasPriorEntry = mode === "edit" && typeof initialGrams === "number";
  const [noLeftover, setNoLeftover] = useState(hasPriorEntry && initialGrams === 0);
  const [fillingGrams, setFillingGrams] = useState(
    hasPriorEntry && typeof initialGrams === "number" && initialGrams > 0 ? String(initialGrams) : ""
  );
  const [fillingComment, setFillingComment] = useState(
    hasPriorEntry && typeof initialComment === "string" ? initialComment : ""
  );
  const [saving, setSaving] = useState(false);

  const fillingValid = !hasFilling || noLeftover || (fillingGrams.trim() !== "" && Number(fillingGrams) >= 0 && Number.isFinite(Number(fillingGrams)));

  const handleDone = async () => {
    if (!fillingValid) return;
    if (hasFilling) {
      const grams = noLeftover ? 0 : Math.round(Number(fillingGrams));
      const comment = fillingComment.trim();
      setSaving(true);
      try {
        await guardedFetch(`/api/production-plans/${planId}/items/${item.id}/leftover-filling`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grams, comment: comment.length > 0 ? comment : null }),
        });
      } catch (err) {
        console.warn("[BuildingStation] Leftover filling save failed:", err);
      } finally {
        setSaving(false);
      }
    }
    onDone();
  };

  return (
    <div className="space-y-5 pt-2">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-7 h-7 text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="font-bold text-xl text-foreground">
            {mode === "edit" ? `Edit — ${item.recipeName ?? "Recipe"}` : `${item.recipeName ?? "Recipe"} complete`}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "edit" ? "Update pack count or leftover filling." : "Any extra packs to record before moving on?"}
          </p>
        </div>
      </div>
      <PackAdjustment planId={planId} item={item} isOnBreak={isOnBreak} stationType={stationType} stationExtraPacks={stationExtraPacks} />

      {hasFilling && (
        <div className="border border-border rounded-xl px-4 py-3 space-y-3">
          <p className="text-sm font-semibold text-muted-foreground">Leftover Filling</p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={noLeftover}
              onChange={(e) => { setNoLeftover(e.target.checked); if (e.target.checked) setFillingGrams(""); }}
              className="w-5 h-5 rounded border-border accent-emerald-600"
            />
            <span className="text-base font-medium">No leftover filling</span>
          </label>
          {!noLeftover && (
            <div className="flex items-center gap-3">
              <input
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="Enter weight"
                value={fillingGrams}
                onChange={(e) => setFillingGrams(e.target.value)}
                className="flex-1 h-12 px-4 text-lg font-bold border border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <span className="text-lg font-semibold text-muted-foreground">g</span>
            </div>
          )}
          <textarea
            value={fillingComment}
            onChange={(e) => setFillingComment(e.target.value.slice(0, 500))}
            placeholder="Comment (optional) — e.g. ran dry, under-portioned…"
            rows={2}
            className="w-full px-4 py-3 text-base border border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          />
        </div>
      )}

      {assemblyData && <BatchDivision assemblyData={assemblyData} portionsPerBatch={item.portionsPerBatch ?? 10} />}

      <button
        type="button"
        onClick={handleDone}
        onTouchEnd={e => { e.preventDefault(); handleDone(); }}
        disabled={!fillingValid || saving}
        className={cn(
          "w-full py-4 rounded-xl font-bold text-lg transition-colors touch-manipulation",
          fillingValid && !saving
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : "bg-muted text-muted-foreground cursor-not-allowed"
        )}
      >
        {saving ? "Saving..." : mode === "edit" ? "Save changes" : "Done — Move On"}
      </button>
    </div>
  );
}

const PARTIAL_PORTIONS = [2, 4, 6, 8] as const;

function BatchDivision({ assemblyData, portionsPerBatch }: { assemblyData: AssemblyData; portionsPerBatch: number }) {
  const [selected, setSelected] = useState<number | null>(null);

  const hasFilling = assemblyData.fillingWeightPerBatch > 0;
  const hasItems = assemblyData.assemblyItems.length > 0;
  if (!hasFilling && !hasItems) return null;

  const scale = selected != null ? selected / portionsPerBatch : 0;

  // Build unified list matching assembly order (same as main checklist)
  type Entry = { key: string; isFilling: boolean; ai?: AssemblyItemData };
  const allItems: Entry[] = [];
  assemblyData.assemblyItems.forEach((ai, i) => allItems.push({ key: `${ai.sourceType}-${ai.sourceId}-${i}`, isFilling: false, ai }));
  if (hasFilling) {
    const pos = Math.min(assemblyData.fillingAssemblyOrder ?? 0, allItems.length);
    allItems.splice(pos, 0, { key: "filling", isFilling: true });
  }

  return (
    <div className="border border-border rounded-xl px-4 py-3 space-y-3">
      <p className="text-sm font-semibold text-muted-foreground">Partial Batch Weights</p>
      <div className="flex gap-2">
        {PARTIAL_PORTIONS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setSelected(prev => prev === p ? null : p)}
            className={cn(
              "flex-1 h-11 rounded-lg text-lg font-bold transition-colors touch-manipulation",
              selected === p
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-background hover:bg-secondary/60"
            )}
          >
            {p}
          </button>
        ))}
      </div>
      {selected != null && (
        <div className="divide-y divide-border/50 -mx-1">
          {allItems.map((entry) => {
            const isTopping = !entry.isFilling && entry.ai?.isTopping;
            const weight = entry.isFilling
              ? assemblyData.fillingWeightPerBatch * scale
              : (entry.ai?.weightPerBatch ?? 0) * scale;
            return (
              <div key={entry.key} className="flex items-center justify-between px-1 py-2">
                <span className={cn("text-base font-bold", entry.isFilling && "text-blue-700 dark:text-blue-400")}>
                  {entry.isFilling ? "Filling" : entry.ai!.name}
                </span>
                {isTopping
                  ? <span className="text-base font-bold font-mono text-slate-500 dark:text-slate-400">Sprinkle</span>
                  : <span className="text-base font-bold font-mono tabular-nums">{Math.round(weight)}g</span>
                }
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MoveToNextRecipeButton({
  item,
  combinedCount,
  isOnBreak,
  onMoveOn,
}: {
  item: ProductionPlanItem;
  combinedCount: number;
  isOnBreak: boolean;
  onMoveOn: () => void;
}) {
  const target = item.batchesTarget ?? 0;
  const isShort = combinedCount < target;

  const handleClick = () => {
    if (isOnBreak) return;
    const built = `${combinedCount}/${target} batch${target === 1 ? "" : "es"} built so far (both builders combined)`;
    const msg =
      `Move on to your next recipe?\n\n` +
      `${built}. Whatever's been built is logged to the oven station.\n\n` +
      `This only moves YOU on — the other builder can keep building this recipe.`;
    if (!window.confirm(msg)) return;
    onMoveOn();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isOnBreak}
      className={cn(
        "w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold border-2 transition-colors disabled:opacity-40",
        isShort
          ? "border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40"
          : "border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40",
      )}
    >
      {isShort ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
      Move to Next Recipe →
    </button>
  );
}

/**
 * Builder-facing "Recipe Finished" control. Sets/clears the item-level
 * builderMarkedCompleteAt flag: once set, ovens and wrapping work to the
 * ACTUAL built count (short of, equal to, or over the planned target)
 * instead of max(planned, built) — the planned target stays visible as
 * reference only. Soft signal: batches/packs can still be added afterwards
 * and every downstream number simply grows to match.
 */
function RecipeFinishedControls({
  planId,
  item,
  combinedCount,
  isOnBreak,
}: {
  planId: number;
  item: ProductionPlanItem;
  combinedCount: number;
  isOnBreak: boolean;
}) {
  const queryClient = useQueryClient();
  const [runAction, busy] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(planId) }),
  });

  const target = item.batchesTarget ?? 0;
  const extras = item.extraPacksBuilt ?? 0;
  const finished = !!item.builderMarkedCompleteAt;
  const isShort = combinedCount < target;

  const markFinished = () => {
    if (isOnBreak) return;
    const summary = `${combinedCount}/${target} batch${target === 1 ? "" : "es"} built (both builders combined)` +
      (extras > 0 ? ` + ${extras} loose pack${extras === 1 ? "" : "s"}` : "");
    const shortWarning = isShort
      ? `\n\nYou are ${target - combinedCount} batch${target - combinedCount === 1 ? "" : "es"} SHORT of the plan — ovens and wrapping will work to the ${combinedCount} that exist, not the planned ${target}.`
      : "";
    const msg =
      `Mark this recipe FINISHED for the day?\n\n` +
      `${summary}.${shortWarning}\n\n` +
      `Ovens and wrapping will process exactly what was built. You can still add batches or packs afterwards if more get made.`;
    if (!window.confirm(msg)) return;
    runAction((signal) =>
      guardedFetch(`/api/production-plans/${planId}/items/${item.id}/builder-complete`, {
        method: "POST", signal,
      })
    );
  };

  const undoFinished = () => {
    if (isOnBreak) return;
    if (!window.confirm("Reopen this recipe? Ovens and wrapping go back to showing the planned target until it's marked finished again.")) return;
    runAction((signal) =>
      guardedFetch(`/api/production-plans/${planId}/items/${item.id}/builder-complete`, {
        method: "DELETE", signal,
      })
    );
  };

  if (finished) {
    return (
      <div className="w-full mt-2 flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border-2 border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20">
        <span className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="w-4 h-4" />
          Finished — ovens working to {combinedCount} batch{combinedCount === 1 ? "" : "es"}{extras > 0 ? ` + ${extras} pack${extras === 1 ? "" : "s"}` : ""}
        </span>
        <button
          type="button"
          onClick={undoFinished}
          disabled={busy || isOnBreak}
          className="text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-40"
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={markFinished}
      disabled={busy || isOnBreak}
      className={cn(
        "w-full mt-2 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold border-2 transition-colors disabled:opacity-40",
        isShort
          ? "border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40"
          : "border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40",
      )}
    >
      <CheckCircle2 className="w-4 h-4" />
      Recipe Finished — send built count to ovens
    </button>
  );
}

function PackAdjustment({ planId, item, isOnBreak, stationType, stationExtraPacks }: { planId: number; item: ProductionPlanItem; isOnBreak: boolean; stationType: "building_1" | "building_2"; stationExtraPacks: number }) {
  const queryClient = useQueryClient();
  const [runAction, busy] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(planId) }),
  });

  // THIS builder's own loose packs (independent of the other builder). Clamp to
  // ≥ 0 — the tally only represents an in-progress partial batch on this station.
  const extraPacks = Math.max(0, stationExtraPacks);

  const adjust = (delta: 1 | -1) => {
    if (isOnBreak) return;
    if (delta === -1 && extraPacks <= 0) return;
    runAction((signal) =>
      guardedFetch(`/api/production-plans/${planId}/items/${item.id}/extra-packs-built`, {
        method: "PATCH", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta, stationType }),
      })
    );
  };
  const addExtra = () => adjust(1);
  const removeExtra = () => adjust(-1);

  return (
    <div className="border border-border rounded-xl px-3 py-2 mt-3">
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground font-semibold">Pack Adjustment</p>
        <div className="flex items-center gap-2 ml-auto">
          {extraPacks > 0 && (
            <button onClick={removeExtra} disabled={busy} className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 underline">
              undo {extraPacks}
            </button>
          )}
          <span className={cn(
            "text-lg font-bold tabular-nums min-w-[2.5rem] text-center",
            extraPacks > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
          )}>
            {extraPacks > 0 ? `+${extraPacks}` : extraPacks}
          </span>
          <button
            onClick={addExtra}
            disabled={busy || isOnBreak}
            className="h-9 px-3 rounded-lg text-sm font-semibold border border-border bg-background hover:bg-secondary/60 disabled:opacity-40 transition-all active:scale-95"
          >
            + Add Pack
          </button>
        </div>
      </div>
    </div>
  );
}

// Admin-only rectification for recipes that were closed before all batches
// landed (e.g. the historical race where a partial-complete locked out the
// other builder's in-flight batch). Posts to /manual-batch, which bypasses
// the builder-marked-complete cap.
function AdminAddMissedBatch({ planId, item }: { planId: number; item: ProductionPlanItem }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [station, setStation] = useState<"building_1" | "building_2">("building_1");
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [packs, setPacks] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [runAction, busy] = useGuardedAction({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(planId) });
      setOpen(false);
      setPacks("");
      setNote("");
      toast({ title: "Missed batch added" });
    },
  });

  const submit = () => {
    const body: Record<string, unknown> = { stationType: station };
    if (mode === "partial") {
      const n = Number(packs);
      if (!Number.isInteger(n) || n < 1) {
        toast({ title: "Enter a valid pack count", variant: "destructive" });
        return;
      }
      body.partialPacks = n;
    }
    if (note.trim()) body.note = note.trim().slice(0, 500);
    runAction((signal) =>
      guardedFetch(`/api/production-plans/${planId}/items/${item.id}/manual-batch`, {
        method: "POST", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full mt-2 flex items-center justify-center gap-2 py-2 text-xs font-semibold border border-dashed border-border rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Admin: add missed batch
      </button>
    );
  }

  return (
    <div className="border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-3 mt-2 bg-amber-50/40 dark:bg-amber-900/10 space-y-2">
      <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Add missed batch</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setStation("building_1")}
          className={cn("flex-1 py-1.5 text-xs rounded-lg border", station === "building_1" ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground")}
        >Building 1</button>
        <button
          type="button"
          onClick={() => setStation("building_2")}
          className={cn("flex-1 py-1.5 text-xs rounded-lg border", station === "building_2" ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground")}
        >Building 2</button>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("full")}
          className={cn("flex-1 py-1.5 text-xs rounded-lg border", mode === "full" ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground")}
        >Full batch</button>
        <button
          type="button"
          onClick={() => setMode("partial")}
          className={cn("flex-1 py-1.5 text-xs rounded-lg border", mode === "partial" ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground")}
        >Partial (packs)</button>
      </div>
      {mode === "partial" && (
        <input
          type="number"
          min={1}
          value={packs}
          onChange={(e) => setPacks(e.target.value)}
          placeholder="Packs in this partial batch"
          className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-background"
        />
      )}
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        maxLength={500}
        className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-background"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="flex-1 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground"
        >Cancel</button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="flex-1 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-40"
        >{busy ? "Adding…" : "Add batch"}</button>
      </div>
    </div>
  );
}
