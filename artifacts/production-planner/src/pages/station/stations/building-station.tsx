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
  ClipboardList, CheckSquare, Square, AlertCircle, Trophy, Eye, X, AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { format, parseISO, differenceInMinutes } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useBuildTimerConfig } from "@/hooks/use-build-timer-config";
import { useBatchBuildTimer } from "@/hooks/use-batch-build-timer";
import { ShopifyConfirmDialog } from "@/components/shopify-confirm-dialog";
// ExtraPackControl removed — replaced by inline PackAdjustment
import { BreakTracker } from "../shared/break-tracker";
import { KpiBar } from "../shared/kpi-bar";
import { EodSummary } from "../shared/eod-summary";
import { getStationCount, getAvailableFromPrev } from "../shared/constants";

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
  asm, hasFilling, canReorder, isLocked, checkedItems, toggleCheck, dndSensors, onDragEnd,
}: {
  asm: AssemblyData;
  hasFilling: boolean;
  canReorder: boolean;
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

  if (canReorder && !isLocked) {
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
                    locked={false}
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
                  locked={false}
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

  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {allItems.map((entry) => (
        <button
          type="button"
          key={entry.key}
          onClick={() => toggleCheck(entry.key)}
          disabled={isLocked}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-3 text-left transition-colors",
            !isLocked && "active:bg-slate-200 dark:active:bg-slate-700"
          )}
        >
          {isLocked || checkedItems[entry.key]
            ? <CheckSquare className="w-6 h-6 text-emerald-500 flex-shrink-0" />
            : <Square className="w-6 h-6 text-slate-400 flex-shrink-0" />}
          <span className={cn("text-2xl font-bold flex-1 leading-tight", entry.isFilling && "text-blue-700 dark:text-blue-400")}>
            {entry.isFilling ? "Filling" : entry.ai!.name}
          </span>
          {!entry.isFilling && entry.ai!.isTopping
            ? <span className="text-2xl font-bold font-mono flex-shrink-0 text-slate-500 dark:text-slate-400">Sprinkle</span>
            : <span className="text-2xl font-bold font-mono tabular-nums flex-shrink-0">
                {Math.round(entry.isFilling ? asm.fillingWeightPerBatch : entry.ai!.weightPerBatch)}g/<span className="text-slate-500 dark:text-slate-400">{Math.round(entry.isFilling ? asm.fillingWeightHalfBatch : entry.ai!.weightHalfBatch)}g</span>
              </span>
          }
        </button>
      ))}
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
}

export function BuildingStation({ plan, lineNumber }: BuildingStationProps) {
  const stationType = lineNumber === 1 ? "building_1" : "building_2";
  const queryClient = useQueryClient();
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Session tracking
  const [sessionStartedAt] = useState<Date>(() => new Date());
  const [sessionBatches, setSessionBatches] = useState(0);
  const [totalBreakMinutes, setTotalBreakMinutes] = useState(0);
  const [activeBreakMinutes, setActiveBreakMinutes] = useState(0);
  const [showEod, setShowEod] = useState(false);
  const [pendingTap, setPendingTap] = useState(false);
  const [isOnBreak, setIsOnBreak] = useState(false);

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

  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
        setSessionBatches(prev => prev + 1);
        setPendingTap(false);
        setLastBatchAt(new Date());
      },
      onError: () => setPendingTap(false),
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
  const [checklistLockedForItem, setChecklistLockedForItem] = useState<number | null>(null);
  const [checklistLoadedForItem, setChecklistLoadedForItem] = useState<number | null>(null);
  const prevRecipeIdRef = useRef<number | null>(null);
  // Prompt for extra packs when a recipe finishes
  const [extraPromptItemId, setExtraPromptItemId] = useState<number | null>(null);
  const [prevCurrentItemId, setPrevCurrentItemId] = useState<number | null>(null);

  const checklistKey = (itemId: number) => `checklist_done_${plan.id}_${stationType}_${itemId}`;

  function getCombinedBuildCount(it: ProductionPlanItem) {
    return getStationCount(it, "building_1") + getStationCount(it, "building_2");
  }

  function getEffectiveTarget(it: ProductionPlanItem) {
    const rawTarget = it.batchesTarget ?? 0;
    const packsPerBatch = Math.max(1, Math.floor((it.portionsPerBatch ?? 10) / 2));
    const totalPacksTarget = rawTarget * packsPerBatch;
    const shorts = it.shortCount ?? 0;
    const extras = it.extraPacksBuilt ?? 0;
    const effectivePacksNeeded = Math.max(0, totalPacksTarget - shorts + extras);
    return Math.ceil(effectivePacksNeeded / packsPerBatch);
  }

  function getLastBatchPacks(it: ProductionPlanItem) {
    const packsPerBatch = Math.max(1, Math.floor((it.portionsPerBatch ?? 10) / 2));
    const totalPacksTarget = (it.batchesTarget ?? 0) * packsPerBatch;
    const shorts = it.shortCount ?? 0;
    const extras = it.extraPacksBuilt ?? 0;
    const effectivePacksNeeded = Math.max(0, totalPacksTarget - shorts + extras);
    const remainder = effectivePacksNeeded % packsPerBatch;
    return remainder;
  }

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const otherStation = stationType === "building_1" ? "building_2" : "building_1";
  const currentItem = items.find(it => {
    const combined = getCombinedBuildCount(it);
    const effectiveTarget = getEffectiveTarget(it);
    if (combined >= effectiveTarget) return false;
    const remainingForItem = effectiveTarget - combined;
    if (remainingForItem === 1) {
      const myCountForItem = getStationCount(it, stationType);
      const otherCountForItem = getStationCount(it, otherStation);
      if (otherCountForItem > myCountForItem) return false;
    }
    return true;
  });

  const waitingOnOtherItem = !currentItem
    ? items.find(it => {
        const combined = getCombinedBuildCount(it);
        const effectiveTarget = getEffectiveTarget(it);
        if (combined >= effectiveTarget) return false;
        if (effectiveTarget - combined !== 1) return false;
        const myCountForItem = getStationCount(it, stationType);
        const otherCountForItem = getStationCount(it, otherStation);
        return otherCountForItem > myCountForItem;
      })
    : undefined;

  const buildingCount = currentItem ? getCombinedBuildCount(currentItem) : 0;
  const effectiveBatches = currentItem ? getEffectiveTarget(currentItem) : 0;
  const myCount = currentItem ? getStationCount(currentItem, stationType) : 0;
  const mixingCount = currentItem ? getStationCount(currentItem, "mixing") : 0;
  const available = currentItem ? Math.max(0, mixingCount - buildingCount) : 0;
  const remaining = currentItem ? Math.max(0, effectiveBatches - buildingCount) : 0;
  const isLastBatchPartial = currentItem ? remaining === 1 && getLastBatchPacks(currentItem) > 0 : false;
  const lastBatchPackCount = currentItem ? getLastBatchPacks(currentItem) : 0;
  const allDone = items.length > 0 && items.every(it =>
    getCombinedBuildCount(it) >= getEffectiveTarget(it)
  );

  const buildTimer = useBatchBuildTimer({
    enabled: timerConfig.enabled === true,
    recipeId: currentItem?.recipeId ?? null,
    targetSeconds: (currentItem as { targetBuildSeconds?: number | null } | undefined)?.targetBuildSeconds ?? null,
    defaultSeconds: timerConfig.defaultSeconds,
    isOnBreak,
    lastBatchAt,
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
      setChecklistLockedForItem(null);
      setChecklistLoadedForItem(null);
    }
  }, [currentItem?.id]);

  // Auto-lock checklist when all items checked
  useEffect(() => {
    if (!currentItem || checklistLockedForItem === currentItem.id) return;
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
    }
  }, [checkedItems, currentItem?.id, assemblyMap, checklistLockedForItem]);

  // Detect recipe change — prompt for extra packs + auto-expand next
  useEffect(() => {
    const curId = currentItem?.id ?? null;
    if (prevCurrentItemId !== null && curId !== prevCurrentItemId) {
      setExtraPromptItemId(prevCurrentItemId);
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
    createBatch.mutate({
      id: plan.id,
      data: {
        planItemId: currentItem.id,
        stationType,
        completedAt: new Date().toISOString(),
      },
    });
  };

  const [runUndo, undoPending] = useGuardedAction({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      setSessionBatches(prev => Math.max(0, prev - 1));
    },
  });
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

  const totalBatchesTarget = items.reduce((s, it) => s + getEffectiveTarget(it), 0);
  const totalBatchesDone = items.reduce((s, it) => s + getCombinedBuildCount(it), 0);
  const overallProgress = totalBatchesTarget > 0 ? Math.round((totalBatchesDone / totalBatchesTarget) * 100) : 0;

  // KPI calculations for daily progress card
  const now = new Date();
  const localActiveMinutes = sessionStartedAt
    ? Math.max(0, differenceInMinutes(now, sessionStartedAt) - totalBreakMinutes - activeBreakMinutes)
    : 0;
  const localBph = localActiveMinutes > 0 ? sessionBatches / (localActiveMinutes / 60) : 0;
  const teamBph = serverKpi?.batchesPerHour ?? 0;
  const youBph = serverKpi?.batchesPerHour != null ? serverKpi.batchesPerHour : localBph;
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
      {showEod && (
        <EodSummary
          planId={plan.id}
          items={items}
          stationType={stationType}
          sessionBatches={sessionBatches}
          totalBreakMinutes={totalBreakMinutes + activeBreakMinutes}
          sessionStartedAt={sessionStartedAt}
          onClose={() => setShowEod(false)}
        />
      )}

      {/* Daily progress + KPI + break buttons */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="font-semibold text-lg">Today's Production</h2>
            <p className="text-base text-muted-foreground">
              {totalBatchesDone} / {totalBatchesTarget} batches complete · Line {lineNumber}
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

        {/* KPI: Team + You batches/hour */}
        {(teamBph > 0 || yourBph > 0) && (
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50">
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

        <div className="mt-3 pt-3 border-t border-border/50">
          <BreakTracker planId={plan.id} stationType={stationType} onBreakChange={handleBreakChange} onBreakActiveChange={setIsOnBreak} />
        </div>
      </div>

      {/* Extra packs prompt — shown when a recipe just finished */}
      {extraPromptItem && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-400 dark:border-amber-600 rounded-xl p-5">
          <div className="flex items-start gap-3 mb-3">
            <AlertCircle className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-lg text-amber-800 dark:text-amber-200">
                Any extra packs for {extraPromptItem.recipeName ?? "this recipe"}?
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">
                Add extra packs or shorts before moving on.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <PackAdjustment planId={plan.id} item={extraPromptItem} isOnBreak={isOnBreak} />
            <button
              onClick={() => setExtraPromptItemId(null)}
              className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-semibold transition-colors ml-3 flex-shrink-0"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Waiting on other builder */}
      {waitingOnOtherItem && !currentItem && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 rounded-xl p-5 text-center">
          <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-2" />
          <h3 className="font-bold text-lg">Waiting on Table {lineNumber === 1 ? 2 : 1}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Finishing the last batch of{" "}
            <span className="font-semibold text-foreground">
              {waitingOnOtherItem.recipeName ?? `Recipe #${waitingOnOtherItem.recipeId}`}
            </span>
          </p>
        </div>
      )}

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
            <button
              onClick={() => setShowEod(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-2 py-1 transition-colors"
            >
              <Trophy className="w-3 h-3" />
              Summary
            </button>
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
            const itemMixing = getStationCount(item, "mixing");
            const itemAvailable = Math.max(0, itemMixing - combinedCount);
            const itemRemaining = Math.max(0, effTarget - combinedCount);
            const itemPct = effTarget > 0 ? Math.round((combinedCount / effTarget) * 100) : 0;
            const itemIsLastPartial = itemRemaining === 1 && getLastBatchPacks(item) > 0;
            const itemLastPackCount = getLastBatchPacks(item);
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
                                  canReorder={!isLocked}
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
                              <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold mt-0.5">
                                {(() => { const raw = Math.ceil(effTarget / item.maxBatchesPerTin); return effTarget > 5 ? Math.max(2, raw) : raw; })()} tins
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

                          {/* Waiting for mixing */}
                          {itemAvailable <= 0 && (
                            <div className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg mb-2">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Waiting for Mixing</p>
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
                                  ? "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 border-2 border-slate-300 dark:border-slate-600 cursor-not-allowed opacity-70"
                                  : itemAvailable <= 0
                                    ? "bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border-2 border-amber-300 cursor-not-allowed opacity-70"
                                    : pendingTap
                                      ? "bg-primary/60 text-primary-foreground cursor-wait"
                                      : buildTimer.alerted
                                        ? "bg-amber-500 text-white border-2 border-amber-600 shadow-lg animate-pulse"
                                        : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg hover:shadow-xl"
                          )}
                        >
                          {timerConfig.enabled && buildTimer.running && !allDone && (
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
                                  ? "Tick items ←"
                                  : itemAvailable <= 0
                                    ? "Waiting…"
                                    : pendingTap
                                      ? "Recording..."
                                      : itemIsLastPartial
                                        ? `PARTIAL — ${itemLastPackCount} pack${itemLastPackCount !== 1 ? "s" : ""} ✓`
                                        : "BATCH DONE ✓"}
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
                            <p className="text-sm text-muted-foreground font-semibold">Batches</p>
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

function PackAdjustment({ planId, item, isOnBreak }: { planId: number; item: ProductionPlanItem; isOnBreak: boolean }) {
  const queryClient = useQueryClient();
  const [runAction, busy] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(planId) }),
  });

  const extraPacks = item.extraPacksBuilt ?? 0;
  const shortCount = item.shortCount ?? 0;
  const net = extraPacks - shortCount;

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

  const addShort = () => {
    if (isOnBreak) return;
    runAction((signal) =>
      guardedFetch(`/api/production-plans/${planId}/items/${item.id}/short`, {
        method: "POST", signal,
      })
    );
  };

  const removeShort = () => {
    if (shortCount <= 0) return;
    runAction((signal) =>
      guardedFetch(`/api/production-plans/${planId}/items/${item.id}/short`, {
        method: "DELETE", signal,
      })
    );
  };

  return (
    <div className="border border-border rounded-xl px-3 py-2 mt-3">
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground font-semibold">Pack Adjustment</p>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={addShort}
            disabled={busy || isOnBreak}
            className="h-9 px-3 rounded-lg text-sm font-semibold border border-border bg-background hover:bg-secondary/60 disabled:opacity-40 transition-all active:scale-95"
          >
            − Short
          </button>
          {shortCount > 0 && (
            <button onClick={removeShort} disabled={busy} className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 underline">
              undo {shortCount}
            </button>
          )}
          <span className={cn(
            "text-lg font-bold tabular-nums min-w-[2.5rem] text-center",
            net > 0 ? "text-emerald-600 dark:text-emerald-400" :
            net < 0 ? "text-red-600 dark:text-red-400" :
            "text-muted-foreground"
          )}>
            {net > 0 ? `+${net}` : net}
          </span>
          {extraPacks > 0 && (
            <button onClick={removeExtra} disabled={busy} className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 underline">
              undo {extraPacks}
            </button>
          )}
          <button
            onClick={addExtra}
            disabled={busy || isOnBreak}
            className="h-9 px-3 rounded-lg text-sm font-semibold border border-border bg-background hover:bg-secondary/60 disabled:opacity-40 transition-all active:scale-95"
          >
            + Extra
          </button>
        </div>
      </div>
    </div>
  );
}
