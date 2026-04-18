import React, { useState, useEffect, useRef, useCallback } from "react";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import {
  useCreateBatchCompletion,
  useUpdateProductionPlanItem,
  useListTimingStandards,
  useGetStationKpi,
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
  ChevronDown, Snowflake,
} from "lucide-react";
import { format, parseISO, differenceInMinutes } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useBuildTimerConfig } from "@/hooks/use-build-timer-config";
import { useBatchBuildTimer } from "@/hooks/use-batch-build-timer";
import { ShopifyConfirmDialog } from "@/components/shopify-confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
// ExtraPackControl removed — replaced by inline PackAdjustment
import { BreakTracker } from "../shared/break-tracker";
import { KpiBar } from "../shared/kpi-bar";
import { getStationCount, getAvailableFromPrev, isMacCheese } from "../shared/constants";
import { effectiveBatchesTarget, packsPerBatch } from "../shared/recipe-completion";

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
  const stationType = lineNumber === 1 ? "building_1" : "building_2";
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
  const [prevCurrentItemId, setPrevCurrentItemId] = useState<number | null>(null);
  // Tracks the plan-item id whose final batch THIS builder just completed.
  // Used to show the extra-packs prompt only to the builder who actually
  // finished the recipe — the other builder (who was on the penultimate batch)
  // moves straight to the next recipe.
  const myLastBatchItemIdRef = useRef<number | null>(null);
  // Part-batch calculator dialog — tracks which item's calculator is open.
  const [calcOpenItemId, setCalcOpenItemId] = useState<number | null>(null);

  const checklistKey = (itemId: number) => `checklist_done_${plan.id}_${stationType}_${itemId}_${userId}`;

  function getCombinedBuildCount(it: ProductionPlanItem) {
    return getStationCount(it, "building_1") + getStationCount(it, "building_2");
  }

  function getEffectiveTarget(it: ProductionPlanItem) {
    return effectiveBatchesTarget(it, getCombinedBuildCount(it));
  }

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  // Find the first recipe that still has batches to build.
  // Both builders can always take the next available batch — the server-side
  // combined count check prevents over-recording if both tap simultaneously.
  const currentItem = items.find(it => {
    const combined = getCombinedBuildCount(it);
    const effectiveTarget = getEffectiveTarget(it);
    return combined < effectiveTarget;
  });

  const buildingCount = currentItem ? getCombinedBuildCount(currentItem) : 0;
  const effectiveBatches = currentItem ? getEffectiveTarget(currentItem) : 0;
  const myCount = currentItem ? getStationCount(currentItem, stationType) : 0;
  // Building is the start of the dependency chain — no mixing dependency.
  // Available = remaining batches to build (not gated by mixing).
  const available = currentItem ? Math.max(0, effectiveBatches - buildingCount) : 0;
  const remaining = currentItem ? Math.max(0, effectiveBatches - buildingCount) : 0;
  const allDone = items.length > 0 && items.every(it =>
    getCombinedBuildCount(it) >= getEffectiveTarget(it)
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
      if (prevItem && getCombinedBuildCount(prevItem) >= getEffectiveTarget(prevItem)) {
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

  const checklistPending = (() => {
    if (!currentItem) return false;
    const asm = assemblyMap[currentItem.id];
    if (!asm) return false;
    if (asm.fillingWeightPerBatch === 0 && asm.assemblyItems.length === 0) return false;
    return checklistLockedForItem !== currentItem.id;
  })();

  const handleBatchComplete = () => {
    if (!currentItem || pendingTap || available <= 0 || isOnBreak || checklistPending) return;
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
        onSuccess: () => {
          if (wasLastBatchTap) {
            myLastBatchItemIdRef.current = completingItemId;
          }
        },
      },
    );
  };

  const [runUndo, undoPending] = useGuardedAction({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      setSessionBatches(prev => Math.max(0, prev - 1));
    },
  });

  // A blast chiller tray is always 10 packs. Mac cheese only. Partial trays
  // (fewer than 10 packs of work left) use the +1/-1 buttons instead.
  const BLAST_TRAY_SIZE = 10;
  const [runBulkBatch, bulkBatchPending] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
  });
  const canAdvanceBlastTray = (item: ProductionPlanItem): boolean => {
    const remaining = Math.max(0, getEffectiveTarget(item) - getCombinedBuildCount(item));
    return isAdmin || remaining >= BLAST_TRAY_SIZE;
  };
  const canUndoBlastTray = (item: ProductionPlanItem): boolean =>
    getStationCount(item, stationType) >= BLAST_TRAY_SIZE;
  const addBlastChillerTray = async (item: ProductionPlanItem) => {
    if (isOnBreak || !canAdvanceBlastTray(item)) return;
    await runBulkBatch(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/batch-completions/bulk`, {
        method: "POST", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType, count: BLAST_TRAY_SIZE }),
      });
      setSessionBatches(prev => prev + BLAST_TRAY_SIZE);
      toast({ title: `Blast chiller tray — ${BLAST_TRAY_SIZE} packs added to the oven queue` });
    });
  };
  const undoBlastChillerTray = async (item: ProductionPlanItem) => {
    if (isOnBreak || !canUndoBlastTray(item)) return;
    await runBulkBatch(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/batch-completions/bulk`, {
        method: "DELETE", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType, count: BLAST_TRAY_SIZE }),
      });
      setSessionBatches(prev => Math.max(0, prev - BLAST_TRAY_SIZE));
      toast({ title: `Blast chiller tray undone — ${BLAST_TRAY_SIZE} packs returned to the build queue` });
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

  const pct = currentItem && effectiveBatches > 0
    ? Math.round((buildingCount / effectiveBatches) * 100)
    : 0;

  // Split totals by product category. Calzone items are tracked as "batches";
  // mac cheese items as "packs" (1 mac batch_completion row = 1 pack because
  // portionsPerBatch=2, packsPerBatch=1).
  const calzoneItems = items.filter(it => !isMacCheese(it as any));
  const macItems = items.filter(it => isMacCheese(it as any));
  const totalBatchesTarget = calzoneItems.reduce((s, it) => s + getEffectiveTarget(it), 0);
  const totalBatchesDone = calzoneItems.reduce((s, it) => s + getCombinedBuildCount(it), 0);
  const totalMacPacksTarget = macItems.reduce((s, it) => s + getEffectiveTarget(it), 0);
  const totalMacPacksDone = macItems.reduce((s, it) => s + getCombinedBuildCount(it), 0);
  const combinedTarget = totalBatchesTarget + totalMacPacksTarget;
  const combinedDone = totalBatchesDone + totalMacPacksDone;
  const overallProgress = combinedTarget > 0 ? Math.round((combinedDone / combinedTarget) * 100) : 0;

  // KPI calculations for daily progress card
  const now = new Date();
  const localActiveMinutes = sessionStartedAt
    ? Math.max(0, differenceInMinutes(now, sessionStartedAt) - totalBreakMinutes - activeBreakMinutes)
    : 0;
  const localBph = localActiveMinutes > 0 ? sessionBatches / (localActiveMinutes / 60) : 0;
  const teamBph = serverKpi?.batchesPerHour ?? 0;
  const teamMacPph = serverKpi?.macPacksPerHour ?? 0;
  // Use local for "you" since serverKpi is per-user already
  const yourBph = localActiveMinutes > 0 ? localBph : 0;

  const bphColor = (bph: number) =>
    targetBph && minBph
      ? bph >= targetBph ? "text-emerald-600 dark:text-emerald-400"
        : bph >= minBph ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400"
      : "text-foreground";

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

        {/* KPI: Team batches/hr + Team mac packs/hr + You batches/hr */}
        {(teamBph > 0 || teamMacPph > 0 || yourBph > 0) && (
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-medium">Team:</span>
              <span className={cn("text-lg font-bold tabular-nums", bphColor(teamBph))}>
                {teamBph.toFixed(1)}/hr
              </span>
            </div>
            {teamMacPph > 0 && (
              <>
                <div className="w-px h-5 bg-border/60" />
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground font-medium">Mac packs:</span>
                  <span className="text-lg font-bold tabular-nums text-foreground">
                    {teamMacPph.toFixed(1)}/hr
                  </span>
                </div>
              </>
            )}
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

      </div>

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
              onDone={() => setExtraPromptItemId(null)}
            />
          )}
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
            const effTarget = getEffectiveTarget(item);
            const isDone = combinedCount >= effTarget;
            const itemMyCount = getStationCount(item, stationType);
            // Building is the start of the chain — available = remaining to build
            const itemAvailable = Math.max(0, effTarget - combinedCount);
            const itemRemaining = Math.max(0, effTarget - combinedCount);
            const itemPct = effTarget > 0 ? Math.round((combinedCount / effTarget) * 100) : 0;
            const asm = assemblyMap[item.id];

            return (
              <div key={item.id}>
                {/* Collapsed summary row */}
                <button
                  onClick={() => toggleExpanded(item.id)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors",
                    isExpanded
                      ? isCurrent
                        ? "bg-primary/5"
                        : "bg-blue-50/60 dark:bg-blue-900/15"
                      : isCurrent
                        ? "bg-primary/5"
                        : isDone
                          ? "bg-emerald-50/30 dark:bg-emerald-900/10"
                          : "hover:bg-secondary/20"
                  )}
                >
                  {/* Position */}
                  <span className="text-xs text-muted-foreground w-5 text-center flex-shrink-0">{item.orderPosition}</span>

                  {/* Recipe name */}
                  <span
                    className={cn(
                      "flex-1 font-bold text-sm truncate",
                      isDone && !isExpanded ? "line-through opacity-60" : ""
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
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <ChevronDown className={cn(
                      "w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform",
                      isExpanded ? "rotate-180" : ""
                    )} />
                  )}
                </button>

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
                      {isDone && (
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

                          {/* All batches built for this item */}
                          {itemAvailable <= 0 && (
                            <div className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-lg mb-2">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                {isMacCheese(item as any) ? "All packs built" : "All batches built"}
                              </p>
                            </div>
                          )}

                          {/* BATCH COMPLETE button */}
                        <button
                          onClick={handleBatchComplete}
                          disabled={pendingTap || isOnBreak || itemAvailable <= 0 || checklistPending}
                          className={cn(
                            "relative overflow-hidden w-full h-[200px] rounded-2xl text-xl sm:text-2xl font-bold transition-all select-none active:scale-95 flex flex-col items-center justify-center gap-1",
                            itemRemaining === 0
                              ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 border-2 border-emerald-400 opacity-60 cursor-not-allowed"
                              : isOnBreak
                                ? "bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border-2 border-amber-300 cursor-not-allowed opacity-70"
                                : checklistPending
                                  ? changeoverActive
                                    ? "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 border-2 border-blue-300 dark:border-blue-700 cursor-not-allowed"
                                    : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 border-2 border-slate-300 dark:border-slate-600 cursor-not-allowed opacity-70"
                                  : itemAvailable <= 0
                                    ? "bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border-2 border-amber-300 cursor-not-allowed opacity-70"
                                    : pendingTap
                                      ? "bg-primary/60 text-primary-foreground cursor-wait"
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
                              : itemRemaining === 0
                                ? "All Done ✓"
                                : checklistPending
                                  ? (changeoverActive ? "Changeover" : "Tick items ←")
                                  : itemAvailable <= 0
                                    ? "Waiting…"
                                    : pendingTap
                                      ? "Recording..."
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

                        {/* Blast chiller tray — mac cheese only. Always advances exactly 10
                            packs at once; partial trays are handled via the main tap button. */}
                        {isMacCheese(item as any) && !isOnBreak && (() => {
                          const canBlast = canAdvanceBlastTray(item) && !bulkBatchPending && !pendingTap;
                          const canUndoBlast = canUndoBlastTray(item) && !bulkBatchPending && !pendingTap;
                          return (
                            <div className="flex items-stretch gap-2">
                              <button
                                onClick={() => undoBlastChillerTray(item)}
                                disabled={!canUndoBlast}
                                title={canUndoBlast ? "Remove the last blast chiller tray (−10 packs)" : "Need at least 10 packs recorded at this station to undo a tray"}
                                className={cn(
                                  "flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold transition-colors",
                                  canUndoBlast
                                    ? "bg-cyan-50 text-cyan-700 hover:bg-cyan-100 border border-cyan-200 dark:bg-cyan-900/20 dark:text-cyan-200 dark:border-cyan-800"
                                    : "bg-cyan-50/40 text-cyan-400 border border-cyan-100 dark:bg-cyan-900/10 dark:text-cyan-500 dark:border-cyan-900 opacity-70 cursor-not-allowed",
                                )}
                              >
                                <Minus className="w-5 h-5" />
                                −10
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
                                Blast Chiller Tray (+10 packs)
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

                          {/* Pack adjustment */}
                          <PackAdjustment planId={plan.id} item={item} isOnBreak={isOnBreak} />

                          {/* Builder override — mark recipe complete early when short on
                              ingredients. Downstream stations pick up the truncated batch
                              count as the new target. */}
                          <MarkCompleteButton
                            planId={plan.id}
                            item={item}
                            combinedCount={combinedCount}
                            isOnBreak={isOnBreak}
                            onMarked={() => setExtraPromptItemId(item.id)}
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
                                  createBatch.mutate({
                                    id: plan.id,
                                    data: { planItemId: item.id, stationType, completedAt: new Date().toISOString() },
                                  });
                                }}
                                disabled={createBatch.isPending || isOnBreak || (combinedCount >= (item.batchesTarget ?? 0) && !isAdmin)}
                                className="w-10 h-10 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 transition-colors"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                        <PackAdjustment planId={plan.id} item={item} isOnBreak={isOnBreak} />
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

function RecipeCompleteDialogBody({ planId, item, isOnBreak, hasFilling, assemblyData, onDone }: {
  planId: number;
  item: ProductionPlanItem;
  isOnBreak: boolean;
  hasFilling: boolean;
  assemblyData?: AssemblyData;
  onDone: () => void;
}) {
  const [noLeftover, setNoLeftover] = useState(false);
  const [fillingGrams, setFillingGrams] = useState("");
  const [fillingComment, setFillingComment] = useState("");
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
            {item.recipeName ?? "Recipe"} complete
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Any extra packs to record before moving on?
          </p>
        </div>
      </div>
      <PackAdjustment planId={planId} item={item} isOnBreak={isOnBreak} />

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
        {saving ? "Saving..." : "Done — Move On"}
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

function MarkCompleteButton({
  planId,
  item,
  combinedCount,
  isOnBreak,
  onMarked,
}: {
  planId: number;
  item: ProductionPlanItem;
  combinedCount: number;
  isOnBreak: boolean;
  onMarked: () => void;
}) {
  const queryClient = useQueryClient();
  const [runAction, busy] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(planId) }),
  });

  // Already marked → nothing to do here.
  if (item.builderMarkedCompleteAt) return null;
  // Only expose the override once at least one batch is in.
  if (combinedCount < 1) return null;
  // If the recipe has already hit its plan target, the normal end-of-recipe
  // prompt fires — no override needed.
  const target = item.batchesTarget ?? 0;
  if (combinedCount >= target) return null;

  const ppb = packsPerBatch(item);
  const extras = item.extraPacksBuilt ?? 0;
  const projectedPacks = combinedCount * ppb + extras;

  const handleClick = () => {
    if (isOnBreak || busy) return;
    const msg =
      `Mark ${item.recipeName ?? "this recipe"} complete at ${combinedCount}/${target} batches?\n\n` +
      `Net output passed to ovens: ${projectedPacks} pack${projectedPacks === 1 ? "" : "s"} ` +
      `(${combinedCount} × ${ppb}${extras > 0 ? ` + ${extras} extra` : ""}).`;
    if (!window.confirm(msg)) return;
    runAction((signal) =>
      guardedFetch(`/api/production-plans/${planId}/items/${item.id}/builder-complete`, {
        method: "POST", signal,
      }).then(() => onMarked())
    );
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || isOnBreak}
      className="w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-40 transition-colors"
    >
      <AlertTriangle className="w-4 h-4" />
      Mark Recipe Complete ({combinedCount}/{target})
    </button>
  );
}

function PackAdjustment({ planId, item, isOnBreak }: { planId: number; item: ProductionPlanItem; isOnBreak: boolean }) {
  const queryClient = useQueryClient();
  const [runAction, busy] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(planId) }),
  });

  const extraPacks = item.extraPacksBuilt ?? 0;

  const addExtra = () => {
    if (isOnBreak) return;
    runAction((signal) =>
      guardedFetch(`/api/production-plans/${planId}/items/${item.id}/extra-packs-built`, {
        method: "PATCH", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: 1 }),
      })
    );
  };

  const removeExtra = () => {
    if (extraPacks <= 0) return;
    runAction((signal) =>
      guardedFetch(`/api/production-plans/${planId}/items/${item.id}/extra-packs-built`, {
        method: "PATCH", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: -1 }),
      })
    );
  };

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
            + Extra Pack
          </button>
        </div>
      </div>
    </div>
  );
}
