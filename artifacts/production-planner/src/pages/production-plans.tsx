import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  useListProductionPlans,
  useGetProductionPlan,
  useGetDptCalculator,
  useListRecipes,
  useGetStationActivity,
  getGetStationActivityQueryKey,
  getGetDptCalculatorQueryKey,
  getListRecipesQueryKey,
  getListProductionPlansQueryKey,
} from "@workspace/api-client-react";
import type { DptSuggestion, ProductionPlanDetail, Recipe } from "@workspace/api-client-react";
type PlanStatus = "draft" | "active" | "prep" | "building" | "complete";
import { useAppMutations } from "@/hooks/use-mutations";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import {
  CalendarDays, Calendar, Plus, Trash2, ChevronLeft, ChevronRight,
  BarChart2, CheckCircle2,
  Loader2, RefreshCw, Info, Package, ClipboardList, ExternalLink,
  Waves, Construction, Flame, Gift, Box, Salad, Layers, Beef,
  ArrowRight, GripVertical, AlertTriangle, AlertCircle, BookmarkCheck, ShoppingCart,
  FlaskConical, Printer, X, ChevronDown, ChevronUp, PoundSterling, ShieldCheck, RotateCcw,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, addDays, parseISO, isWeekend, isToday, startOfWeek, isSameDay } from "date-fns";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useLocation, useSearch } from "wouter";
import { cn } from "@/lib/utils";
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
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type PlanView = "list" | "detail";

const STATUS_CONFIG = {
  draft: { label: "Draft", color: "bg-secondary text-secondary-foreground", icon: ClipboardList },
  active: { label: "Active", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: BarChart2 },
  prep: { label: "Prep", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: ClipboardList },
  building: { label: "Building", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", icon: BarChart2 },
  complete: { label: "Complete", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: CheckCircle2 },
  completed: { label: "Complete", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: CheckCircle2 },
} as const;

function getNextWorkingDay(from: Date): Date {
  let d = addDays(from, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

/** Returns the earliest date that is at least N working days from today */
function addWorkingDays(from: Date, n: number): Date {
  let d = new Date(from);
  let added = 0;
  while (added < n) {
    d = addDays(d, 1);
    if (!isWeekend(d)) added++;
  }
  return d;
}

/** Minimum allowed plan date: 2 working days from today */
function getMinPlanDate(): Date {
  return addWorkingDays(new Date(), 2);
}

function toNextWeekdayIfWeekend(dateStr: string): string {
  const d = parseISO(dateStr);
  if (!isWeekend(d)) return dateStr;
  // Advance to Monday
  let next = d;
  while (isWeekend(next)) next = addDays(next, 1);
  return toLocalDateStr(next);
}

function toLocalDateStr(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function julianBatchNumber(dateStr: string): string {
  const d = parseISO(dateStr);
  const year = d.getFullYear() % 100;
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  return `${year}${String(dayOfYear).padStart(3, "0")}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sortable row for DPT items
// ──────────────────────────────────────────────────────────────────────────────
interface PlanItem {
  id: string;
  recipeId: number;
  recipeName: string;
  recipeColor: string | null;
  included: boolean;
  suggestedBatches: number;
  batchesTarget: number;
  tinCount: number | null;
  maxBatchesPerTin: number | null;
  tinSize: string | null;
  salesPercent: number;
  portionsPerBatch: number;
  packsPerBatch: number;
  sopUrl: string | null;
  isFromDpt: boolean;
  fridgeStock: number;
  prevProduction: number;
  estimatedFactoryNumber: number;
  dispatch1Qty: number;
  dispatch2Qty: number;
  dispatch3Qty: number;
  totalDispatchQty: number;
  deficit: number;
  deficitBatches: number;
  surplusBatches: number;
  stockWarning: "ok" | "low" | "short";
  special1Count: number;
  special2Count: number;
  special3Count: number;
  totalSpecialCount: number;
}

function computeNextFactory(item: PlanItem): number {
  return item.estimatedFactoryNumber + (item.batchesTarget * item.packsPerBatch) - (item.dispatch2Qty + item.dispatch3Qty);
}

function computeStockWarning(item: PlanItem): "ok" | "low" | "short" {
  const afterProduction = item.estimatedFactoryNumber + (item.batchesTarget * item.packsPerBatch);
  const surplus = afterProduction - (item.dispatch2Qty + item.dispatch3Qty);
  if (surplus < 0) return "short";
  if (surplus <= 10) return "low";
  return "ok";
}

interface SortableRowProps {
  item: PlanItem;
  saving: boolean;
  onToggle: (id: string) => void;
  onBatchChange: (id: string, val: number) => void;
  onFridgeStockChange: (id: string, val: number) => void;
  onRemove: (id: string) => void;
}

function SortableRow({ item, saving, onToggle, onBatchChange, onFridgeStockChange, onRemove }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const warning = computeStockWarning(item);

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={cn(
        "border-b border-border/50 last:border-0 transition-colors",
        item.included ? "bg-card" : "bg-secondary/20 opacity-60",
        isDragging ? "shadow-lg" : ""
      )}
    >
      <td className="py-2 px-1.5">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5"
          title="Drag to reorder"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
      </td>
      <td className="py-2 px-1.5">
        <input
          type="checkbox"
          checked={item.included}
          onChange={() => onToggle(item.id)}
          className="rounded border-border"
        />
      </td>
      <td className="py-2 px-2">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm" style={item.recipeColor ? { color: item.recipeColor } : undefined}>{item.recipeName}</span>
          {item.sopUrl && (
            <a href={item.sopUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors" title="Open SOP">
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {!item.isFromDpt && (
            <span className="text-[10px] bg-secondary text-muted-foreground px-1 py-0.5 rounded">manual</span>
          )}
        </div>
      </td>
      <td className="py-2 px-2 text-center">
        <input
          type="number"
          min={0}
          value={item.fridgeStock === 0 ? "" : item.fridgeStock}
          onChange={e => onFridgeStockChange(item.id, e.target.value === "" ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0))}
          disabled={saving}
          className="w-20 px-1.5 py-1 bg-background border border-border rounded-lg text-xs text-center focus-ring disabled:opacity-40 tabular-nums"
          placeholder="0"
        />
      </td>
      <td className="py-2 px-2 text-center tabular-nums text-xs text-red-500">
        <div>{item.dispatch1Qty || "—"}</div>
        {item.special1Count > 0 && <div className="text-[9px] text-muted-foreground leading-tight">incl. {item.special1Count} club special</div>}
      </td>
      <td className="py-2 px-2 text-center tabular-nums text-xs text-green-600 dark:text-green-400">{item.prevProduction ? `+${item.prevProduction}` : "—"}</td>
      <td className="py-2 px-2 text-center tabular-nums text-sm font-medium">
        <span className={cn(
          item.estimatedFactoryNumber < 0 && "text-red-600 dark:text-red-400",
        )}>
          {item.estimatedFactoryNumber}
        </span>
      </td>
      <td className="py-2 px-2 text-center tabular-nums text-xs text-red-500">
        <div>{item.dispatch2Qty || "—"}</div>
        {item.special2Count > 0 && <div className="text-[9px] text-muted-foreground leading-tight">incl. {item.special2Count} club special</div>}
      </td>
      <td className="py-2 px-2 text-center tabular-nums text-xs text-red-500">
        <div>{item.dispatch3Qty || "—"}</div>
        {item.special3Count > 0 && <div className="text-[9px] text-muted-foreground leading-tight">incl. {item.special3Count} club special</div>}
      </td>
      <td className="py-2 px-2 text-center tabular-nums text-xs">
        {item.deficit > 0 ? <span className="text-red-600 dark:text-red-400 font-semibold">-{item.deficit}</span> : "0"}
      </td>
      <td className="py-2 px-2 text-center">
        <input
          type="number"
          min={0}
          value={item.batchesTarget}
          onChange={e => onBatchChange(item.id, Number(e.target.value))}
          disabled={!item.included || saving}
          className="w-16 px-1.5 py-1 bg-background border border-border rounded-lg text-xs text-center focus-ring disabled:opacity-40 tabular-nums"
        />
      </td>
      <td className="py-2 px-1.5 text-right">
        <button
          onClick={() => onRemove(item.id)}
          className="p-0.5 text-muted-foreground hover:text-destructive transition-colors rounded"
          title="Remove from plan"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </td>
    </tr>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Create Plan Dialog
// ──────────────────────────────────────────────────────────────────────────────
interface CreatePlanDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (planId: number) => void;
  initialDate?: Date;
}

interface CalcRecipe {
  recipeId: number;
  recipeName: string;
  color: string | null;
  isCoreMenu: boolean;
  portionsPerBatch: number;
  packSize: number;
  packsPerBatch: number;
  tinSize: string | null;
  maxBatchesPerTin: number | null;
  sopUrl: string | null;
  isCoreMenu?: boolean;
  fridgeStock: number;
  // Predicted end-of-today fridge stock from /calculate (factory number
  // accounting loop). Core recipes get the full prediction; non-core
  // recipes fall back to `fridgeStock` while the feature flag is on.
  predictedFridgeStock?: number;
  remainingWrappingPacksToday?: number;
  remainingFulfilmentPacksToday?: number;
  prevProduction: number;
  estimatedFactoryNumber: number;
  dispatch1Qty: number;
  dispatch2Qty: number;
  dispatch3Qty: number;
  totalDispatchQty: number;
  deficit: number;
  deficitBatches: number;
  salesPercent: number;
  packsSold: number;
  stockWarning: "ok" | "low" | "short";
  salesSource: "shopify" | "dpt";
  surplusBatches: number;
  suggestedBatches: number;
  tinCount: number | null;
  nextFactoryNumber: number;
  totalDailyBatches: number;
  totalPacksSold: number;
  special1Count: number;
  special2Count: number;
  special3Count: number;
  totalSpecialCount: number;
}

interface CalcResponse {
  planDate: string;
  prevProductionDate: string;
  deliveryDates: string[];
  totalDailyBatches: number;
  totalDeficitBatches: number;
  remainingCapacity: number;
  salesSource: "shopify" | "dpt";
  shopifyError: string | null;
  unmatchedRecipes: string[];
  recipes: CalcRecipe[];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchCalculation(planDate: string): Promise<CalcResponse> {
  const res = await fetch(`${BASE}/api/production-plans/calculate?planDate=${planDate}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch calculation");
  return res.json();
}

function CreatePlanDialog({ open, onClose, onCreated, initialDate }: CreatePlanDialogProps) {
  const { state: authState } = useAuth();
  const userRole = authState.status === "authenticated" ? authState.user.role : undefined;
  const isAdmin = userRole === "admin";
  const minPlanDate = getMinPlanDate();
  const defaultDate = initialDate ?? (isAdmin ? new Date() : minPlanDate);
  const [planDate, setPlanDate] = useState(toLocalDateStr(defaultDate));
  const [prepDate, setPrepDate] = useState("");
  const [planName, setPlanName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<PlanItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addRecipeId, setAddRecipeId] = useState<string>("");
  const [dateWarning, setDateWarning] = useState<string | null>(null);
  const [totalBatchesOverride, setTotalBatchesOverride] = useState<number | null>(null);
  const [savedOrder, setSavedOrder] = useState<number[]>([]);
  const [orderSaved, setOrderSaved] = useState(false);

  // Runtime feature flag from the backend — controls whether the
  // Factory Number column shows a "Core menu only" scope badge. When
  // the server-side flag flips to false, this automatically updates
  // on the next dialog open without a frontend rebuild.
  const [factoryConfig, setFactoryConfig] = useState<{ coreMenuOnly: boolean } | null>(null);
  useEffect(() => {
    if (!open) return;
    fetch("/api/stock-entries/factory-number-config", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => setFactoryConfig(d))
      .catch(() => setFactoryConfig(null));
  }, [open]);

  // Sync date when dialog opens with a selected date
  useEffect(() => {
    if (open && initialDate) {
      setPlanDate(toLocalDateStr(initialDate));
    }
  }, [open, initialDate]);

  // Fetch stored production order on open
  useEffect(() => {
    if (!open) return;
    fetch("/api/app-settings/production_order_recipe_ids", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.value) {
          try { setSavedOrder(JSON.parse(d.value)); } catch { /* ignore malformed */ }
        }
      })
      .catch(() => {});
  }, [open]);

  const { data: calcData, isLoading: loadingCalc, refetch: refetchCalc } = useQuery({
    queryKey: ["production-plan-calculate", planDate],
    queryFn: () => fetchCalculation(planDate),
    enabled: open && !!planDate,
  });

  const effectiveTotalBatches = totalBatchesOverride ?? calcData?.totalDailyBatches ?? 0;

  const { data: allRecipes } = useListRecipes({ query: { queryKey: getListRecipesQueryKey(), enabled: open } });
  const { createPlan, updatePlan } = useAppMutations();
  const queryClient = useQueryClient();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // ── Auto-save state ──────────────────────────────────────────────────────────
  const isDirty = useRef(false);
  const autoSavedPlanId = useRef<number | null>(null);
  const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(null);
  const autoSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shadow refs so the 30s interval always reads current form values
  const itemsRef = useRef(items);
  const planDateRef = useRef(planDate);
  const planNameRef = useRef(planName);
  const notesRef = useRef(notes);
  const prepDateRef = useRef(prepDate);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { planDateRef.current = planDate; }, [planDate]);
  useEffect(() => { planNameRef.current = planName; }, [planName]);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { prepDateRef.current = prepDate; }, [prepDate]);

  // Reset dirty state when dialog closes
  useEffect(() => {
    if (!open) {
      isDirty.current = false;
      autoSavedPlanId.current = null;
      setAutoSavedAt(null);
      if (autoSavedTimerRef.current) {
        clearTimeout(autoSavedTimerRef.current);
        autoSavedTimerRef.current = null;
      }
    }
  }, [open]);

  // Auto-save: every 30s, silently create or update a draft if the form is dirty
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(async () => {
      if (!isDirty.current) return;
      const currentItems = itemsRef.current.filter(it => it.included);
      if (currentItems.length === 0) return;
      const payload = {
        planDate: planDateRef.current,
        prepDate: prepDateRef.current || null,
        name: planNameRef.current || `Plan ${planDateRef.current}`,
        notes: notesRef.current || undefined,
        status: "draft" as const,
        items: currentItems.map((it, i) => ({
          recipeId: it.recipeId,
          orderPosition: i + 1,
          batchesTarget: it.batchesTarget,
          tinSize: it.tinSize ?? undefined,
          maxBatchesPerTin: it.maxBatchesPerTin ?? undefined,
          sopUrl: it.sopUrl ?? undefined,
        })),
      };
      try {
        if (autoSavedPlanId.current === null) {
          const res = await fetch(`${BASE}/api/production-plans`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) return;
          const created = await res.json();
          autoSavedPlanId.current = created.id;
          queryClient.invalidateQueries({ queryKey: getListProductionPlansQueryKey() });
        } else {
          const res = await fetch(`${BASE}/api/production-plans/${autoSavedPlanId.current}`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) return;
        }
        isDirty.current = false;
        setAutoSavedAt(new Date());
        if (autoSavedTimerRef.current) clearTimeout(autoSavedTimerRef.current);
        autoSavedTimerRef.current = setTimeout(() => setAutoSavedAt(null), 2000);
      } catch {
        // silent fail — will retry on next tick
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [open]);

  const handleDateChange = (raw: string) => {
    if (!raw) return;
    isDirty.current = true;
    let fixed = toNextWeekdayIfWeekend(raw);
    const warnings: string[] = [];
    if (fixed !== raw) warnings.push("Weekends are not production days — date moved to the next Monday.");
    if (!isAdmin) {
      const min = getMinPlanDate();
      if (parseISO(fixed) < min) {
        fixed = toLocalDateStr(min);
        warnings.push("Plans must be created at least 2 working days in advance.");
      }
    }
    setDateWarning(warnings.length ? warnings.join(" ") : null);
    setPlanDate(fixed);
  };

  useEffect(() => {
    if (planDate) {
      const d = parseISO(planDate);
      setPlanName(`Production Plan – ${format(d, "EEEE d MMM yyyy")}`);
    }
  }, [planDate]);

  const allocateBatches = useCallback((recipes: CalcRecipe[], capacity: number): { suggestedBatches: number; surplusBatches: number }[] => {
    if (capacity <= 0) {
      return recipes.map(() => ({ suggestedBatches: 0, surplusBatches: 0 }));
    }

    const totalDeficitBatches = recipes.reduce((s, r) => s + r.deficitBatches, 0);

    if (totalDeficitBatches <= capacity) {
      // Normal case: capacity covers all deficits — distribute remainder as surplus by sales %
      const remaining = capacity - totalDeficitBatches;
      const totalPacksSold = recipes.reduce((s, r) => s + r.packsSold, 0);

      const rawSurplus = recipes.map(r => {
        const exact = totalPacksSold > 0 ? (r.salesPercent / 100) * remaining : 0;
        return { exact, floor: Math.floor(exact) };
      });

      let leftover = remaining - rawSurplus.reduce((s, r) => s + r.floor, 0);
      const sorted = rawSurplus
        .map((r, idx) => ({ idx, remainder: r.exact - r.floor }))
        .sort((a, b) => b.remainder - a.remainder);
      const bonusSet = new Set<number>();
      for (const { idx } of sorted) {
        if (leftover <= 0) break;
        bonusSet.add(idx);
        leftover--;
      }

      return recipes.map((r, idx) => {
        const surplusBatches = rawSurplus[idx].floor + (bonusSet.has(idx) ? 1 : 0);
        return { suggestedBatches: r.deficitBatches + surplusBatches, surplusBatches };
      });
    } else {
      // Constrained case: capacity < total deficit — scale each recipe down proportionally
      const rawAlloc = recipes.map(r => {
        const exact = (r.deficitBatches / totalDeficitBatches) * capacity;
        return { exact, floor: Math.floor(exact) };
      });

      let leftover = capacity - rawAlloc.reduce((s, r) => s + r.floor, 0);
      const sorted = rawAlloc
        .map((r, idx) => ({ idx, remainder: r.exact - r.floor }))
        .sort((a, b) => b.remainder - a.remainder);
      const bonusSet = new Set<number>();
      for (const { idx } of sorted) {
        if (leftover <= 0) break;
        bonusSet.add(idx);
        leftover--;
      }

      return recipes.map((r, idx) => {
        const suggestedBatches = rawAlloc[idx].floor + (bonusSet.has(idx) ? 1 : 0);
        return { suggestedBatches, surplusBatches: 0 };
      });
    }
  }, []);

  useEffect(() => {
    if (!calcData?.recipes) return;
    setTotalBatchesOverride(null);
    const capacity = calcData.totalDailyBatches;
    const alloc = allocateBatches(calcData.recipes, capacity);
    // Capture any manual batch edits the user has already made so we can preserve them
    const prevItems = itemsRef.current;
    const newItems: PlanItem[] = calcData.recipes.map((r: CalcRecipe, idx: number) => {
      const suggested = alloc[idx].suggestedBatches;
      const prev = prevItems.find(p => p.recipeId === r.recipeId);
      // If the user has manually changed the batch count away from the previously suggested value,
      // keep their edit rather than overwriting it on recalculate.
      const batchesTarget =
        prev && prev.batchesTarget !== prev.suggestedBatches ? prev.batchesTarget : suggested;
      return {
        id: `calc-${r.recipeId}`,
        recipeId: r.recipeId,
        recipeName: r.recipeName,
        recipeColor: r.color ?? null,
        included: prev ? prev.included : (suggested > 0 || r.deficit > 0 || r.isCoreMenu),
        suggestedBatches: suggested,
        batchesTarget,
        tinCount: r.tinCount,
        maxBatchesPerTin: r.maxBatchesPerTin,
        tinSize: r.tinSize,
        salesPercent: r.salesPercent,
        portionsPerBatch: r.portionsPerBatch,
        packsPerBatch: r.packsPerBatch,
        sopUrl: r.sopUrl,
        isFromDpt: true,
        // Seed with predicted end-of-today fridge stock so the DPT
        // calculation uses the right baseline regardless of what time
        // the user opens the form. Non-core recipes (with the feature
        // flag on) receive `predictedFridgeStock == fridgeStock` from
        // the backend.
        fridgeStock: prev ? prev.fridgeStock : (r.predictedFridgeStock ?? r.fridgeStock),
        prevProduction: r.prevProduction,
        estimatedFactoryNumber: r.estimatedFactoryNumber,
        dispatch1Qty: r.dispatch1Qty,
        dispatch2Qty: r.dispatch2Qty,
        dispatch3Qty: r.dispatch3Qty,
        totalDispatchQty: r.totalDispatchQty,
        deficit: r.deficit,
        deficitBatches: r.deficitBatches,
        surplusBatches: alloc[idx].surplusBatches,
        stockWarning: r.stockWarning,
        special1Count: r.special1Count ?? 0,
        special2Count: r.special2Count ?? 0,
        special3Count: r.special3Count ?? 0,
        totalSpecialCount: r.totalSpecialCount ?? 0,
      };
    });
    // Apply saved default order: known recipes sorted first, unknowns appended at the end
    if (savedOrder.length > 0) {
      newItems.sort((a, b) => {
        const ai = savedOrder.indexOf(a.recipeId);
        const bi = savedOrder.indexOf(b.recipeId);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    }
    setItems(newItems);
  }, [calcData, allocateBatches, savedOrder]);

  const handleTotalBatchesChange = useCallback((newTotal: number) => {
    isDirty.current = true;
    setTotalBatchesOverride(newTotal);
    if (!calcData?.recipes) return;
    const alloc = allocateBatches(calcData.recipes, newTotal);
    setItems(prev => prev.map((item, idx) => {
      const calcRecipe = calcData.recipes.find((r: CalcRecipe) => r.recipeId === item.recipeId);
      if (!calcRecipe || !item.isFromDpt) return item;
      const allocIdx = calcData.recipes.indexOf(calcRecipe);
      if (allocIdx < 0) return item;
      const suggested = alloc[allocIdx].suggestedBatches;
      return {
        ...item,
        suggestedBatches: suggested,
        batchesTarget: suggested,
        surplusBatches: alloc[allocIdx].surplusBatches,
        tinCount: (() => { if (!item.maxBatchesPerTin || suggested <= 0) return null; const raw = Math.ceil(suggested / item.maxBatchesPerTin); return suggested > 5 ? Math.max(2, raw) : raw; })(),
      };
    }));
  }, [calcData, allocateBatches]);

  const recalcTins = (batchesTarget: number, maxBatchesPerTin: number | null): number | null => {
    if (!maxBatchesPerTin || batchesTarget <= 0) return null;
    const raw = Math.ceil(batchesTarget / maxBatchesPerTin);
    return batchesTarget > 5 ? Math.max(2, raw) : raw;
  };

  const updateItem = (id: string, updates: Partial<PlanItem>) => {
    isDirty.current = true;
    setItems(prev =>
      prev.map(it => {
        if (it.id !== id) return it;
        const merged = { ...it, ...updates };
        if ("batchesTarget" in updates) {
          merged.tinCount = recalcTins(merged.batchesTarget, merged.maxBatchesPerTin);
        }
        return merged;
      })
    );
  };

  const fridgeStockTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleFridgeStockOverride = useCallback((id: string, newStock: number) => {
    setItems(prev =>
      prev.map(it => {
        if (it.id !== id) return it;
        const estimatedFactoryNumber = newStock - it.dispatch1Qty + it.prevProduction;
        const deficit = Math.max(0, it.dispatch2Qty + it.dispatch3Qty - estimatedFactoryNumber);
        const deficitBatches = it.packsPerBatch > 0 ? Math.ceil(deficit / it.packsPerBatch) : 0;
        return { ...it, fridgeStock: newStock, estimatedFactoryNumber, deficit, deficitBatches };
      })
    );

    const item = items.find(it => it.id === id);
    if (!item) return;
    if (fridgeStockTimers.current[id]) clearTimeout(fridgeStockTimers.current[id]);
    fridgeStockTimers.current[id] = setTimeout(async () => {
      try {
        await fetch(`${BASE}/api/stock-entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            recipeId: item.recipeId,
            ingredientId: null,
            itemType: "recipe",
            quantity: newStock,
            unit: "packs",
            location: "production_fridge",
            notes: "Calculator override",
          }),
        });
      } catch (e) {
        console.error("Failed to save fridge stock override", e);
      }
    }, 800);
  }, [items]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      isDirty.current = true;
      setItems(prev => {
        const oldIdx = prev.findIndex(it => it.id === active.id);
        const newIdx = prev.findIndex(it => it.id === over.id);
        const next = arrayMove(prev, oldIdx, newIdx);
        const orderIds = next.map(it => it.recipeId);
        setSavedOrder(orderIds);
        setOrderSaved(true);
        setTimeout(() => setOrderSaved(false), 2000);
        fetch("/api/app-settings/production_order_recipe_ids", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: JSON.stringify(orderIds) }),
        }).catch(() => {});
        return next;
      });
    }
  };

  const addRecipeToList = () => {
    const recipeId = Number(addRecipeId);
    if (!recipeId) return;
    if (items.some(it => it.recipeId === recipeId)) {
      setAddRecipeId("");
      return;
    }
    const recipe = allRecipes?.find((r: Recipe) => r.id === recipeId);
    if (!recipe) return;
    const portionsPerBatch = recipe.portionsPerBatch ?? 10;
    const packSize = recipe.packSize ?? 1;
    const newItem: PlanItem = {
      id: `manual-${recipeId}`,
      recipeId,
      recipeName: recipe.name,
      recipeColor: (recipe as any).color ?? null,
      included: true,
      suggestedBatches: 0,
      batchesTarget: 0,
      tinCount: null,
      maxBatchesPerTin: recipe.maxBatchesPerTin ?? null,
      tinSize: recipe.tinSize ?? null,
      salesPercent: 0,
      portionsPerBatch,
      packsPerBatch: portionsPerBatch / packSize,
      sopUrl: recipe.sopUrl ?? null,
      isFromDpt: false,
      fridgeStock: 0,
      prevProduction: 0,
      estimatedFactoryNumber: 0,
      dispatch1Qty: 0,
      dispatch2Qty: 0,
      dispatch3Qty: 0,
      totalDispatchQty: 0,
      deficit: 0,
      deficitBatches: 0,
      surplusBatches: 0,
      stockWarning: "ok",
      special1Count: 0,
      special2Count: 0,
      special3Count: 0,
      totalSpecialCount: 0,
    };
    isDirty.current = true;
    setItems(prev => [...prev, newItem]);
    setAddRecipeId("");
  };

  const handleSubmit = async (targetStatus: "draft" | "active") => {
    const includedItems = items.filter(it => it.included);
    if (includedItems.length === 0) return;

    setIsSubmitting(true);
    try {
      const data = {
        planDate,
        prepDate: prepDate || null,
        name: planName || `Plan ${planDate}`,
        notes: notes || undefined,
        status: targetStatus,
        items: includedItems.map((it, i) => ({
          recipeId: it.recipeId,
          orderPosition: i + 1,
          batchesTarget: it.batchesTarget,
          tinSize: it.tinSize ?? undefined,
          maxBatchesPerTin: it.maxBatchesPerTin ?? undefined,
          sopUrl: it.sopUrl ?? undefined,
        })),
      };

      if (autoSavedPlanId.current !== null) {
        updatePlan.mutate(
          { id: autoSavedPlanId.current, data },
          {
            onSuccess: (plan) => {
              isDirty.current = false;
              autoSavedPlanId.current = null;
              onClose();
              onCreated?.(plan.id);
            },
            onSettled: () => setIsSubmitting(false),
          }
        );
      } else {
        createPlan.mutate(
          { data },
          {
            onSuccess: (plan) => {
              onClose();
              onCreated?.(plan.id);
            },
            onSettled: () => setIsSubmitting(false),
          }
        );
      }
    } catch {
      setIsSubmitting(false);
    }
  };

  const includedCount = items.filter(it => it.included).length;
  const availableToAdd = (allRecipes ?? []).filter((r: Recipe) => !items.some(it => it.recipeId === r.id));
  const deliveryDates = calcData?.deliveryDates ?? [];
  const dispatchDates = (calcData as { dispatchDates?: string[] } | undefined)?.dispatchDates ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[95vw] w-[1200px] bg-card border-border rounded-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="pb-4 border-b border-border flex-shrink-0">
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" />
            Create Production Plan
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-1 pt-1">
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <label className="text-sm font-medium mb-1 block text-muted-foreground">Production Date</label>
              <input
                type="date"
                value={planDate}
                min={isAdmin ? undefined : toLocalDateStr(minPlanDate)}
                onChange={e => handleDateChange(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus-ring"
              />
              {dateWarning && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                  <Info className="w-3 h-3 flex-shrink-0" />
                  {dateWarning}
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block text-muted-foreground">
                Prep Date <span className="font-normal text-muted-foreground/60">(optional override)</span>
              </label>
              <input
                type="date"
                value={prepDate}
                max={planDate}
                onChange={e => { isDirty.current = true; setPrepDate(e.target.value); }}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus-ring"
              />
              {!prepDate && (
                <p className="text-xs text-muted-foreground mt-1">Defaults to previous production day</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block text-muted-foreground">Plan Name</label>
              <input
                value={planName}
                onChange={e => { isDirty.current = true; setPlanName(e.target.value); }}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus-ring"
                placeholder="Auto-generated from date"
              />
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1 block text-muted-foreground">Notes</label>
              <textarea
                value={notes}
                onChange={e => { isDirty.current = true; setNotes(e.target.value); }}
                rows={2}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus-ring resize-none"
                placeholder="Optional notes for this plan..."
              />
            </div>
          </div>

          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-primary" />
              Production Calculator
              <span className="text-muted-foreground font-normal text-xs">
                ({includedCount} of {items.length} included · drag to reorder)
              </span>
            </h3>
            <div className="flex items-center gap-3">
              {orderSaved && (
                <span className="text-xs flex items-center gap-1 text-emerald-600 dark:text-emerald-400 animate-in fade-in duration-200">
                  <BookmarkCheck className="w-3 h-3" /> Order auto-saved
                </span>
              )}
              <button
                onClick={() => refetchCalc()}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Recalculate
              </button>
            </div>
          </div>

          {loadingCalc ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Calculating targets...
            </div>
          ) : (
            <>
              {items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground bg-secondary/20 rounded-xl mb-3">
                  <Info className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No active DPT settings found.</p>
                  <p className="text-xs mt-1">
                    Add recipes below or{" "}
                    <a
                      href={`${BASE}/settings?section=production&sub=dpt`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline font-medium inline-flex items-center gap-0.5"
                    >
                      configure DPT settings
                      <ExternalLink className="w-3 h-3 ml-0.5" />
                    </a>
                    {" "}in Production Settings.
                  </p>
                </div>
              ) : (
                <div className="border border-border rounded-xl overflow-x-auto mb-3">
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={items.map(it => it.id)} strategy={verticalListSortingStrategy}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-secondary/30 border-b border-border">
                            <th className="w-7 py-2 px-1.5" />
                            <th className="w-7 py-2 px-1.5">
                              <input
                                type="checkbox"
                                checked={items.every(it => it.included)}
                                onChange={e => { isDirty.current = true; setItems(prev => prev.map(it => ({ ...it, included: e.target.checked }))); }}
                                className="rounded border-border"
                              />
                            </th>
                            <th className="py-2 px-2 text-left font-medium text-muted-foreground">Recipe</th>
                            <th
                              className="py-2 px-2 text-center font-medium text-muted-foreground min-w-[70px]"
                              title="Predicted packs in the fridge at end-of-today = live + remaining wrapping − remaining fulfilment"
                            >
                              <div className="flex flex-col items-center gap-0.5">
                                <span>Factory Number</span>
                                {factoryConfig && (
                                  <span className="text-[9px] text-primary/80 font-normal tracking-tight">
                                    {factoryConfig.coreMenuOnly ? "Core menu · predicted" : "Predicted"}
                                  </span>
                                )}
                              </div>
                            </th>
                            <th className="py-2 px-2 text-center font-medium text-red-500 min-w-[70px]" title={dispatchDates[0] ? `Dispatched ${format(parseISO(dispatchDates[0]), "EEE d MMM")} — delivered ${deliveryDates[0] ? format(parseISO(deliveryDates[0]), "EEE d MMM") : ""}` : "Next dispatch"}>
                              {dispatchDates[0] ? `\u2212 ${format(parseISO(dispatchDates[0]), "EEE")} Dispatch` : "\u2212 Dispatch"}
                            </th>
                            <th className="py-2 px-2 text-center font-medium text-green-600 min-w-[70px]" title={calcData?.prevProductionDate ? `Production coming in from ${format(parseISO(calcData.prevProductionDate), "EEE d MMM")} plan` : "Previous day's production output"}>
                              {calcData?.prevProductionDate ? `+ ${format(parseISO(calcData.prevProductionDate), "EEE")} Production` : "+ Prev Production"}
                            </th>
                            <th className="py-2 px-2 text-center font-medium text-muted-foreground min-w-[80px]" title="Next day's factory number: Factory Number − Dispatch + Production">= Next Factory Number</th>
                            <th className="py-2 px-2 text-center font-medium text-red-500 min-w-[70px]" title={dispatchDates[1] ? `Dispatched ${format(parseISO(dispatchDates[1]), "EEE d MMM")} — delivered ${deliveryDates[1] ? format(parseISO(deliveryDates[1]), "EEE d MMM") : ""}` : "Dispatch 2"}>
                              {dispatchDates[1] ? `\u2212 ${format(parseISO(dispatchDates[1]), "EEE")} Dispatch` : "\u2212 Dispatch"}
                            </th>
                            <th className="py-2 px-2 text-center font-medium text-red-500 min-w-[70px]" title={dispatchDates[2] ? `Dispatched ${format(parseISO(dispatchDates[2]), "EEE d MMM")} — delivered ${deliveryDates[2] ? format(parseISO(deliveryDates[2]), "EEE d MMM") : ""}` : "Dispatch 3"}>
                              {dispatchDates[2] ? `\u2212 ${format(parseISO(dispatchDates[2]), "EEE")} Dispatch` : "\u2212 Dispatch"}
                            </th>
                            <th className="py-2 px-2 text-center font-medium text-muted-foreground whitespace-nowrap" title="Packs short — need to produce at least this many">Deficit</th>
                            <th className="py-2 px-2 text-center font-medium text-muted-foreground whitespace-nowrap" title="Batches you want to make">Batches</th>
                            <th className="w-7 py-2 px-1.5" />
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it) => (
                            <SortableRow
                              key={it.id}
                              item={it}
                              saving={isSubmitting}
                              onToggle={(id) => updateItem(id, { included: !it.included })}
                              onBatchChange={(id, val) => updateItem(id, { batchesTarget: val })}
                              onFridgeStockChange={(id, val) => handleFridgeStockOverride(id, val)}
                              onRemove={(id) => { isDirty.current = true; setItems(prev => prev.filter(i => i.id !== id)); }}
                            />
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-secondary/20 border-t border-border font-medium text-xs">
                            <td colSpan={3} className="py-2 px-2 text-right text-muted-foreground">Totals</td>
                            <td className="py-2 px-2 text-center tabular-nums">{items.reduce((s, i) => s + i.fridgeStock, 0)}</td>
                            <td className="py-2 px-2 text-center tabular-nums text-red-500">{items.reduce((s, i) => s + i.dispatch1Qty, 0) || "—"}</td>
                            <td className="py-2 px-2 text-center tabular-nums text-green-600 dark:text-green-400">{items.reduce((s, i) => s + i.prevProduction, 0) || "—"}</td>
                            <td className="py-2 px-2 text-center tabular-nums font-medium">{items.reduce((s, i) => s + i.estimatedFactoryNumber, 0)}</td>
                            <td className="py-2 px-2 text-center tabular-nums text-red-500">{items.reduce((s, i) => s + i.dispatch2Qty, 0) || "—"}</td>
                            <td className="py-2 px-2 text-center tabular-nums text-red-500">{items.reduce((s, i) => s + i.dispatch3Qty, 0) || "—"}</td>
                            <td className="py-2 px-2 text-center tabular-nums">{items.reduce((s, i) => s + i.deficit, 0) || "—"}</td>
                            <td className="py-2 px-2 text-center tabular-nums font-semibold">{items.filter(i => i.included).reduce((s, i) => s + i.batchesTarget, 0)}</td>
                            <td className="py-2 px-1.5" />
                          </tr>
                        </tfoot>
                      </table>
                    </SortableContext>
                  </DndContext>
                </div>
              )}

              {availableToAdd.length > 0 && (
                <div className="flex items-center gap-2 mb-3">
                  <select
                    value={addRecipeId}
                    onChange={e => setAddRecipeId(e.target.value)}
                    className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus-ring"
                  >
                    <option value="">Add a recipe to this plan...</option>
                    {availableToAdd.map((r: Recipe) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={addRecipeToList}
                    disabled={!addRecipeId}
                    className="px-3 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 disabled:opacity-40 flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add
                  </button>
                </div>
              )}

              {calcData?.salesSource === "dpt" && (
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-xl mb-3 text-sm text-blue-700 dark:text-blue-300">
                  <Info className="w-4 h-4 flex-shrink-0" />
                  Dispatch estimates are based on DPT settings (Shopify data unavailable). Actual orders may differ.
                </div>
              )}
              {calcData?.shopifyError && calcData?.salesSource === "shopify" && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl mb-3 text-sm text-amber-700 dark:text-amber-300">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {calcData.shopifyError}
                </div>
              )}
              {calcData?.unmatchedRecipes && calcData.unmatchedRecipes.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl mb-3 text-sm text-amber-700 dark:text-amber-300">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  No Shopify match found for: {calcData.unmatchedRecipes.join(", ")}. Dispatch quantities for these use DPT estimates.
                </div>
              )}

              {items.some(i => computeStockWarning(i) === "short") && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl mb-3 text-sm text-red-700 dark:text-red-300">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  Stock shortfall detected — some recipes don't have enough to cover the next 3 dispatches even with planned production.
                </div>
              )}
              {items.some(i => computeStockWarning(i) === "low") && !items.some(i => computeStockWarning(i) === "short") && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl mb-3 text-sm text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  Low stock warning — some recipes are within 10 packs of covering the next 3 dispatches.
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-border pt-4 flex items-center justify-between flex-shrink-0">
          <div className="text-sm text-muted-foreground flex items-center gap-4">
            <span>
              Julian batch: <span className="font-mono font-semibold text-foreground">{julianBatchNumber(planDate)}</span>
            </span>
            {calcData && (
              <span className="flex items-center gap-1.5">
                Total batches:
                <input
                  type="number"
                  min={0}
                  value={effectiveTotalBatches}
                  onChange={e => handleTotalBatchesChange(Math.max(0, Number(e.target.value)))}
                  className="w-16 px-1.5 py-0.5 bg-background border border-border rounded-lg text-sm text-center font-semibold text-foreground focus-ring tabular-nums"
                />
                {totalBatchesOverride !== null && totalBatchesOverride !== calcData.totalDailyBatches && (
                  <button
                    onClick={() => handleTotalBatchesChange(calcData.totalDailyBatches)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
                    title={`Reset to default (${calcData.totalDailyBatches})`}
                  >
                    reset
                  </button>
                )}
              </span>
            )}
            <span className="text-xs">
              Planned: <span className={cn(
                "font-semibold",
                items.filter(i => i.included).reduce((s, i) => s + i.batchesTarget, 0) > effectiveTotalBatches
                  ? "text-red-600 dark:text-red-400"
                  : "text-foreground"
              )}>
                {items.filter(i => i.included).reduce((s, i) => s + i.batchesTarget, 0)}
              </span>
              {" / "}
              {effectiveTotalBatches}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {autoSavedAt && (
              <span className="text-xs flex items-center gap-1 text-emerald-600 dark:text-emerald-400 animate-in fade-in duration-200">
                <BookmarkCheck className="w-3 h-3" /> Auto-saved
              </span>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => handleSubmit("draft")}
              disabled={includedCount === 0 || isSubmitting}
              className="px-4 py-2 text-sm border border-border bg-secondary text-secondary-foreground rounded-xl font-medium disabled:opacity-50 flex items-center gap-2 transition-colors hover:bg-secondary/80"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
              Save as Draft
            </button>
            <button
              onClick={() => handleSubmit("active")}
              disabled={includedCount === 0 || isSubmitting}
              className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-xl font-medium disabled:opacity-50 flex items-center gap-2 transition-opacity shadow-md shadow-primary/20 hover:opacity-90"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Activate & Lock ({includedCount})
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground text-right mt-1">
            Activating locks batch numbers — they won't change as new orders come in.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Edit Draft Dialog — allows reopening a draft plan in editable form
// ──────────────────────────────────────────────────────────────────────────────
interface EditDraftDialogProps {
  plan: ProductionPlanDetail;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function EditDraftDialog({ plan, open, onClose, onSaved }: EditDraftDialogProps) {
  const { state: editAuthState } = useAuth();
  const editUserRole = editAuthState.status === "authenticated" ? editAuthState.user.role : undefined;
  const editIsAdmin = editUserRole === "admin";
  const [planDate, setPlanDate] = useState(plan.planDate);
  const [prepDate, setPrepDate] = useState((plan as any).prepDate ?? "");
  const [planName, setPlanName] = useState(plan.name);
  const [notes, setNotes] = useState(plan.notes ?? "");
  const [dateWarning, setDateWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addRecipeId, setAddRecipeId] = useState<string>("");

  const [items, setItems] = useState<PlanItem[]>(() =>
    (plan.items ?? []).map(it => ({
      id: `existing-${it.id}`,
      recipeId: it.recipeId,
      recipeName: it.recipeName ?? `Recipe #${it.recipeId}`,
      recipeColor: it.recipeColor ?? null,
      included: true,
      suggestedBatches: 0,
      batchesTarget: it.batchesTarget ?? 0,
      tinCount: (() => { const b = it.batchesTarget ?? 0; if (!it.maxBatchesPerTin || b <= 0) return null; const raw = Math.ceil(b / it.maxBatchesPerTin); return b > 5 ? Math.max(2, raw) : raw; })(),
      maxBatchesPerTin: it.maxBatchesPerTin ?? null,
      tinSize: it.tinSize ?? null,
      salesPercent: 0,
      portionsPerBatch: it.portionsPerBatch ?? 10,
      packsPerBatch: (it.portionsPerBatch ?? 10),
      sopUrl: it.sopUrl ?? null,
      isFromDpt: false,
      fridgeStock: 0,
      prevProduction: 0,
      estimatedFactoryNumber: 0,
      dispatch1Qty: 0,
      dispatch2Qty: 0,
      dispatch3Qty: 0,
      totalDispatchQty: 0,
      deficit: 0,
      deficitBatches: 0,
      surplusBatches: 0,
      stockWarning: "ok" as const,
      special1Count: 0,
      special2Count: 0,
      special3Count: 0,
      totalSpecialCount: 0,
    }))
  );

  const { data: allRecipes } = useListRecipes({ query: { queryKey: getListRecipesQueryKey(), enabled: open } });
  const { updatePlan } = useAppMutations();
  const queryClient = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // ── Update Factory Number (re-run DPT) state ────────────────────────────────
  // Clicking the Update button runs /calculate for this plan's date and
  // opens a diff modal. The user accepts/rejects per recipe, then the
  // selected rows overwrite batchesTarget in the local items state.
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateCalcData, setUpdateCalcData] = useState<CalcResponse | null>(null);

  async function handleUpdateFactoryNumber() {
    setUpdateLoading(true);
    setUpdateError(null);
    try {
      const data = await fetchCalculation(planDate);
      setUpdateCalcData(data);
      setUpdateModalOpen(true);
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : "Failed to refresh factory numbers");
    } finally {
      setUpdateLoading(false);
    }
  }

  function applyUpdatedBatches(selected: Array<{ recipeId: number; newBatches: number }>) {
    isDirty.current = true;
    setItems(prev => prev.map(it => {
      const match = selected.find(s => s.recipeId === it.recipeId);
      if (!match) return it;
      return {
        ...it,
        batchesTarget: match.newBatches,
        tinCount: (() => { if (!it.maxBatchesPerTin || match.newBatches <= 0) return null; const raw = Math.ceil(match.newBatches / it.maxBatchesPerTin); return match.newBatches > 5 ? Math.max(2, raw) : raw; })(),
      };
    }));
    setUpdateModalOpen(false);
    setUpdateCalcData(null);
  }

  // ── Auto-save state ──────────────────────────────────────────────────────────
  const isDirty = useRef(false);
  const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(null);
  const autoSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shadow refs so the 30s interval always reads current form values
  const itemsRef = useRef(items);
  const planDateRef = useRef(planDate);
  const planNameRef = useRef(planName);
  const notesRef = useRef(notes);
  const prepDateRef = useRef(prepDate);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { planDateRef.current = planDate; }, [planDate]);
  useEffect(() => { planNameRef.current = planName; }, [planName]);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { prepDateRef.current = prepDate; }, [prepDate]);

  // Reset dirty state when dialog closes
  useEffect(() => {
    if (!open) {
      isDirty.current = false;
      setAutoSavedAt(null);
      if (autoSavedTimerRef.current) {
        clearTimeout(autoSavedTimerRef.current);
        autoSavedTimerRef.current = null;
      }
    }
  }, [open]);

  // Auto-save: every 30s, silently update the draft if the form is dirty
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(async () => {
      if (!isDirty.current) return;
      const currentItems = itemsRef.current.filter(it => it.included);
      if (currentItems.length === 0) return;
      const payload = {
        planDate: planDateRef.current,
        name: planNameRef.current || plan.name,
        notes: notesRef.current || undefined,
        status: "draft" as const,
        items: currentItems.map((it, i) => ({
          recipeId: it.recipeId,
          orderPosition: i + 1,
          batchesTarget: it.batchesTarget,
          tinSize: it.tinSize ?? undefined,
          maxBatchesPerTin: it.maxBatchesPerTin ?? undefined,
          sopUrl: it.sopUrl ?? undefined,
        })),
      };
      try {
        const res = await fetch(`${BASE}/api/production-plans/${plan.id}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) return;
        isDirty.current = false;
        queryClient.invalidateQueries({ queryKey: getListProductionPlansQueryKey() });
        setAutoSavedAt(new Date());
        if (autoSavedTimerRef.current) clearTimeout(autoSavedTimerRef.current);
        autoSavedTimerRef.current = setTimeout(() => setAutoSavedAt(null), 2000);
      } catch {
        // silent fail — will retry on next tick
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [open]);

  const editMinPlanDate = getMinPlanDate();

  const handleDateChange = (raw: string) => {
    if (!raw) return;
    isDirty.current = true;
    let fixed = toNextWeekdayIfWeekend(raw);
    const warnings: string[] = [];
    if (fixed !== raw) warnings.push("Weekends are not production days — date moved to the next Monday.");
    if (!editIsAdmin) {
      if (parseISO(fixed) < editMinPlanDate) {
        fixed = toLocalDateStr(editMinPlanDate);
        warnings.push("Plans must be created at least 2 working days in advance.");
      }
    }
    setDateWarning(warnings.length ? warnings.join(" ") : null);
    setPlanDate(fixed);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      isDirty.current = true;
      setItems(prev => {
        const oldIdx = prev.findIndex(it => it.id === active.id);
        const newIdx = prev.findIndex(it => it.id === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  };

  const recalcTins = (batchesTarget: number, maxBatchesPerTin: number | null): number | null => {
    if (!maxBatchesPerTin || batchesTarget <= 0) return null;
    const raw = Math.ceil(batchesTarget / maxBatchesPerTin);
    return batchesTarget > 5 ? Math.max(2, raw) : raw;
  };

  const updateItem = (id: string, updates: Partial<PlanItem>) => {
    isDirty.current = true;
    setItems(prev =>
      prev.map(it => {
        if (it.id !== id) return it;
        const merged = { ...it, ...updates };
        if ("batchesTarget" in updates) {
          merged.tinCount = recalcTins(merged.batchesTarget, merged.maxBatchesPerTin);
        }
        return merged;
      })
    );
  };

  const editFridgeStockTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleFridgeStockOverride = useCallback((id: string, newStock: number) => {
    setItems(prev =>
      prev.map(it => {
        if (it.id !== id) return it;
        const estimatedFactoryNumber = newStock - it.dispatch1Qty + it.prevProduction;
        const deficit = Math.max(0, it.dispatch2Qty + it.dispatch3Qty - estimatedFactoryNumber);
        const deficitBatches = it.packsPerBatch > 0 ? Math.ceil(deficit / it.packsPerBatch) : 0;
        return { ...it, fridgeStock: newStock, estimatedFactoryNumber, deficit, deficitBatches };
      })
    );

    const item = items.find(it => it.id === id);
    if (!item) return;
    if (editFridgeStockTimers.current[id]) clearTimeout(editFridgeStockTimers.current[id]);
    editFridgeStockTimers.current[id] = setTimeout(async () => {
      try {
        await fetch(`${BASE}/api/stock-entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            recipeId: item.recipeId,
            ingredientId: null,
            itemType: "recipe",
            quantity: newStock,
            unit: "packs",
            location: "production_fridge",
            notes: "Calculator override",
          }),
        });
      } catch (e) {
        console.error("Failed to save fridge stock override", e);
      }
    }, 800);
  }, [items]);

  const addRecipeToList = () => {
    const recipeId = Number(addRecipeId);
    if (!recipeId) return;
    if (items.some(it => it.recipeId === recipeId)) { setAddRecipeId(""); return; }
    const recipe = (allRecipes as Recipe[] | undefined)?.find(r => r.id === recipeId);
    if (!recipe) return;
    const ppb = recipe.portionsPerBatch ?? 10;
    isDirty.current = true;
    setItems(prev => [...prev, {
      id: `add-${recipeId}`,
      recipeId,
      recipeName: recipe.name,
      recipeColor: (recipe as any).color ?? null,
      included: true,
      suggestedBatches: 0,
      batchesTarget: 0,
      tinCount: null,
      maxBatchesPerTin: recipe.maxBatchesPerTin ?? null,
      tinSize: recipe.tinSize ?? null,
      salesPercent: 0,
      portionsPerBatch: ppb,
      packsPerBatch: ppb / (recipe.packSize ?? 1),
      sopUrl: recipe.sopUrl ?? null,
      isFromDpt: false,
      fridgeStock: 0,
      prevProduction: 0,
      estimatedFactoryNumber: 0,
      dispatch1Qty: 0,
      dispatch2Qty: 0,
      dispatch3Qty: 0,
      totalDispatchQty: 0,
      deficit: 0,
      deficitBatches: 0,
      surplusBatches: 0,
      stockWarning: "ok" as const,
      special1Count: 0,
      special2Count: 0,
      special3Count: 0,
      totalSpecialCount: 0,
    }]);
    setAddRecipeId("");
  };

  const handleSave = async (targetStatus: "draft" | "active") => {
    const includedItems = items.filter(it => it.included);
    if (includedItems.length === 0) return;
    setIsSubmitting(true);
    updatePlan.mutate(
      {
        id: plan.id,
        data: {
          planDate,
          prepDate: prepDate || null,
          name: planName,
          notes: notes || undefined,
          status: targetStatus,
          items: includedItems.map((it, i) => ({
            recipeId: it.recipeId,
            orderPosition: i + 1,
            batchesTarget: it.batchesTarget,
            tinSize: it.tinSize ?? undefined,
            maxBatchesPerTin: it.maxBatchesPerTin ?? undefined,
            sopUrl: it.sopUrl ?? undefined,
          })),
        },
      },
      {
        onSuccess: () => { onSaved(); onClose(); },
        onSettled: () => setIsSubmitting(false),
      }
    );
  };

  const includedCount = items.filter(it => it.included).length;
  const availableToAdd = ((allRecipes as Recipe[] | undefined) ?? []).filter(r => !items.some(it => it.recipeId === r.id));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[95vw] w-[1200px] bg-card border-border rounded-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="pb-4 border-b border-border flex-shrink-0">
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary" />
            Edit Draft Plan
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-1 pt-1">
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <label className="text-sm font-medium mb-1 block text-muted-foreground">Production Date</label>
              <input
                type="date"
                value={planDate}
                min={editIsAdmin ? undefined : toLocalDateStr(editMinPlanDate)}
                onChange={e => handleDateChange(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus-ring"
              />
              {dateWarning && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                  <Info className="w-3 h-3 flex-shrink-0" />
                  {dateWarning}
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block text-muted-foreground">
                Prep Date <span className="font-normal text-muted-foreground/60">(optional override)</span>
              </label>
              <input
                type="date"
                value={prepDate}
                max={planDate}
                onChange={e => { isDirty.current = true; setPrepDate(e.target.value); }}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus-ring"
              />
              {!prepDate && (
                <p className="text-xs text-muted-foreground mt-1">Defaults to previous production day</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block text-muted-foreground">Plan Name</label>
              <input
                value={planName}
                onChange={e => { isDirty.current = true; setPlanName(e.target.value); }}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus-ring"
              />
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1 block text-muted-foreground">Notes</label>
              <textarea
                value={notes}
                onChange={e => { isDirty.current = true; setNotes(e.target.value); }}
                rows={2}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus-ring resize-none"
                placeholder="Optional notes..."
              />
            </div>
          </div>

          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-primary" />
              Production Items
              <span className="text-muted-foreground font-normal text-xs">
                ({includedCount} of {items.length} included · drag to reorder)
              </span>
            </h3>
            <button
              type="button"
              onClick={handleUpdateFactoryNumber}
              disabled={updateLoading || items.length === 0}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-lg bg-background hover:bg-secondary/60 transition-colors disabled:opacity-40"
              title="Refresh factory numbers from live stock and recompute DPT suggestions — old values stay until you accept the new ones."
            >
              {updateLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Update Factory Number
            </button>
          </div>
          {updateError && (
            <div className="mb-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {updateError}
            </div>
          )}

          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground bg-secondary/20 rounded-xl mb-3">
              <Info className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No items — add recipes below.</p>
            </div>
          ) : (
            <div className="border border-border rounded-xl overflow-x-auto mb-3">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={items.map(it => it.id)} strategy={verticalListSortingStrategy}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-secondary/30 border-b border-border">
                        <th className="w-7 py-2 px-1.5" />
                        <th className="w-7 py-2 px-1.5">
                          <input
                            type="checkbox"
                            checked={items.every(it => it.included)}
                            onChange={e => { isDirty.current = true; setItems(prev => prev.map(it => ({ ...it, included: e.target.checked }))); }}
                            className="rounded border-border"
                          />
                        </th>
                        <th className="py-2 px-2 text-left font-medium text-muted-foreground">Recipe</th>
                        <th className="py-2 px-2 text-center font-medium text-muted-foreground min-w-[70px]">Factory Number</th>
                        <th className="py-2 px-2 text-center font-medium text-red-500 min-w-[70px]">&minus; Dispatch</th>
                        <th className="py-2 px-2 text-center font-medium text-green-600 min-w-[70px]">+ Production</th>
                        <th className="py-2 px-2 text-center font-medium text-muted-foreground min-w-[80px]">= Next Factory Number</th>
                        <th className="py-2 px-2 text-center font-medium text-red-500 min-w-[70px]">&minus; Dispatch</th>
                        <th className="py-2 px-2 text-center font-medium text-red-500 min-w-[70px]">&minus; Dispatch</th>
                        <th className="py-2 px-2 text-center font-medium text-muted-foreground whitespace-nowrap">Deficit</th>
                        <th className="py-2 px-2 text-center font-medium text-muted-foreground whitespace-nowrap">Batches</th>
                        <th className="w-7 py-2 px-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(it => (
                        <SortableRow
                          key={it.id}
                          item={it}
                          saving={isSubmitting}
                          onToggle={(id) => updateItem(id, { included: !it.included })}
                          onBatchChange={(id, val) => updateItem(id, { batchesTarget: val })}
                          onFridgeStockChange={(id, val) => handleFridgeStockOverride(id, val)}
                          onRemove={(id) => { isDirty.current = true; setItems(prev => prev.filter(i => i.id !== id)); }}
                        />
                      ))}
                    </tbody>
                  </table>
                </SortableContext>
              </DndContext>
            </div>
          )}

          {availableToAdd.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <select
                value={addRecipeId}
                onChange={e => setAddRecipeId(e.target.value)}
                className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus-ring"
              >
                <option value="">Add a recipe to this plan...</option>
                {availableToAdd.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <button
                onClick={addRecipeToList}
                disabled={!addRecipeId}
                className="px-3 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 disabled:opacity-40 flex items-center gap-1.5 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-4 flex items-center justify-between flex-shrink-0">
          <div className="text-sm text-muted-foreground">
            Julian batch: <span className="font-mono font-semibold text-foreground">{julianBatchNumber(planDate)}</span>
          </div>
          <div className="flex items-center gap-3">
            {autoSavedAt && (
              <span className="text-xs flex items-center gap-1 text-emerald-600 dark:text-emerald-400 animate-in fade-in duration-200">
                <BookmarkCheck className="w-3 h-3" /> Auto-saved
              </span>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => handleSave("draft")}
              disabled={includedCount === 0 || isSubmitting}
              className="px-4 py-2 text-sm border border-border bg-secondary text-secondary-foreground rounded-xl font-medium disabled:opacity-50 flex items-center gap-2 hover:bg-secondary/80 transition-colors"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
              Save Draft
            </button>
            <button
              onClick={() => handleSave("active")}
              disabled={includedCount === 0 || isSubmitting}
              className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-xl font-medium disabled:opacity-50 flex items-center gap-2 shadow-md shadow-primary/20 hover:opacity-90 transition-opacity"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Activate & Lock ({includedCount})
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground text-right mt-1">
            Activating locks batch numbers — they won't change as new orders come in.
          </p>
        </div>
      </DialogContent>
      {updateModalOpen && updateCalcData && (
        <UpdateFactoryDiffModal
          currentItems={items}
          calcData={updateCalcData}
          onApply={applyUpdatedBatches}
          onCancel={() => { setUpdateModalOpen(false); setUpdateCalcData(null); }}
        />
      )}
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Update Factory Number — diff modal
// ──────────────────────────────────────────────────────────────────────────────
// Shown when the user clicks the "Update Factory Number" button in the
// Edit Plan dialog. For every recipe in the current plan, compares the
// saved batchesTarget against the freshly-calculated suggestedBatches
// from /calculate (which is now driven by the predicted fridge stock).
// User accepts/rejects per row; only accepted rows overwrite the local
// items state on apply.
interface UpdateFactoryDiffModalProps {
  currentItems: PlanItem[];
  calcData: CalcResponse;
  onApply: (selected: Array<{ recipeId: number; newBatches: number }>) => void;
  onCancel: () => void;
}

function UpdateFactoryDiffModal({ currentItems, calcData, onApply, onCancel }: UpdateFactoryDiffModalProps) {
  const rows = currentItems.map(item => {
    const calc = calcData.recipes.find(r => r.recipeId === item.recipeId);
    const oldBatches = item.batchesTarget;
    const newBatches = calc?.suggestedBatches ?? oldBatches;
    const delta = newBatches - oldBatches;
    return {
      recipeId: item.recipeId,
      recipeName: item.recipeName,
      recipeColor: item.recipeColor,
      oldBatches,
      newBatches,
      delta,
      predictedFridgeStock: (calc as unknown as { predictedFridgeStock?: number })?.predictedFridgeStock ?? calc?.fridgeStock ?? 0,
      hasCalc: !!calc,
    };
  });

  // Default: pre-check every row that has a change (delta != 0). Rows
  // without changes are rendered but unchecked so the user can tick
  // them explicitly if they want to force-apply.
  const [checked, setChecked] = useState<Record<number, boolean>>(() => {
    const initial: Record<number, boolean> = {};
    for (const row of rows) {
      initial[row.recipeId] = row.delta !== 0 && row.hasCalc;
    }
    return initial;
  });

  const selectedCount = Object.values(checked).filter(Boolean).length;
  const changedCount = rows.filter(r => r.delta !== 0).length;

  function toggle(recipeId: number) {
    setChecked(prev => ({ ...prev, [recipeId]: !prev[recipeId] }));
  }

  function apply() {
    const selected = rows
      .filter(r => checked[r.recipeId])
      .map(r => ({ recipeId: r.recipeId, newBatches: r.newBatches }));
    onApply(selected);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
        <div className="p-5 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-primary" />
              Update Factory Number
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              New DPT suggestions based on the latest predicted end-of-day fridge stock.
              Tick the rows you want to apply — unticked rows keep their current values.
              {" "}
              <span className="font-medium">{changedCount}</span> of {rows.length} have changed.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex-shrink-0"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 border-b border-border">
                <tr>
                  <th className="w-8 py-2 px-2">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every(r => checked[r.recipeId])}
                      onChange={e => {
                        const all = e.target.checked;
                        setChecked(Object.fromEntries(rows.map(r => [r.recipeId, all && r.hasCalc])));
                      }}
                      className="rounded border-border cursor-pointer"
                      title="Select all"
                    />
                  </th>
                  <th className="py-2 px-3 text-left font-medium text-muted-foreground">Recipe</th>
                  <th className="py-2 px-3 text-center font-medium text-muted-foreground">Predicted Factory #</th>
                  <th className="py-2 px-3 text-center font-medium text-muted-foreground">Old → New</th>
                  <th className="py-2 px-3 text-center font-medium text-muted-foreground">Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map(row => {
                  const isChecked = !!checked[row.recipeId];
                  const deltaColor = row.delta > 0 ? "text-emerald-600" : row.delta < 0 ? "text-red-600" : "text-muted-foreground";
                  return (
                    <tr key={row.recipeId} className={cn("transition-colors", isChecked ? "bg-primary/5" : "hover:bg-secondary/20")}>
                      <td className="py-2 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={!row.hasCalc}
                          onChange={() => toggle(row.recipeId)}
                          className="rounded border-border cursor-pointer disabled:opacity-40"
                        />
                      </td>
                      <td className="py-2 px-3 font-medium" style={row.recipeColor ? { color: row.recipeColor } : undefined}>
                        {row.recipeName}
                        {!row.hasCalc && <span className="ml-2 text-[10px] text-muted-foreground font-normal">(no DPT data)</span>}
                      </td>
                      <td className="py-2 px-3 text-center tabular-nums text-muted-foreground">{row.predictedFridgeStock}</td>
                      <td className="py-2 px-3 text-center tabular-nums">
                        <span className="text-muted-foreground">{row.oldBatches}</span>
                        <span className="mx-1.5 text-muted-foreground">→</span>
                        <span className="font-semibold">{row.newBatches}</span>
                      </td>
                      <td className={cn("py-2 px-3 text-center tabular-nums font-bold", deltaColor)}>
                        {row.delta === 0 ? "—" : row.delta > 0 ? `+${row.delta}` : row.delta}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-5 border-t border-border flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {selectedCount} recipe{selectedCount !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={apply}
              disabled={selectedCount === 0}
              className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-xl font-medium disabled:opacity-50 flex items-center gap-2 shadow-md shadow-primary/20 hover:opacity-90 transition-opacity"
            >
              <CheckCircle2 className="w-4 h-4" />
              Apply Selected
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Raw Materials Manifest Modal
// ──────────────────────────────────────────────────────────────────────────────
interface RawMaterialsIngredient {
  ingredientId: number;
  name: string;
  unit: string;
  quantity: number;
  estimatedCost?: number | null;
}

interface RawMaterialsSubRecipe {
  subRecipeId: number;
  name: string;
  totalWeightRequired: number;
  unit: string;
  components: RawMaterialsIngredient[];
}

interface RawMaterialsRecipe {
  recipeId: number;
  recipeName: string;
  batchesTarget: number;
  directIngredients: RawMaterialsIngredient[];
  subRecipes: RawMaterialsSubRecipe[];
}

interface RawMaterialsData {
  planId: number;
  planDate: string;
  planName: string;
  batchNumber: number | null;
  recipes: RawMaterialsRecipe[];
  totals: RawMaterialsIngredient[];
  totalEstimatedCost: number | null;
  costIsPartial: boolean;
}

function fmtQty(qty: number, unit: string): string {
  const rounded = unit === "g" || unit === "ml" ? Math.round(qty) : Math.round(qty * 100) / 100;
  return `${rounded.toLocaleString()} ${unit}`;
}

interface RawMaterialsManifestProps {
  planId: number;
  planName: string;
  onClose: () => void;
}

function RawMaterialsManifest({ planId, planName, onClose }: RawMaterialsManifestProps) {
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [orderResult, setOrderResult] = useState<{ ordersCreated: number; ordersUpdated: number; orders: Array<{ orderId: number; supplierName: string; lineCount: number; action: string }> } | null>(null);
  const [showPacked, setShowPacked] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({});

  const toggle = (key: string) => setChecks(prev => ({ ...prev, [key]: !prev[key] }));

  const cb = (id: string) => (
    <td key={id} className="py-1.5 px-2 text-center">
      <input
        type="checkbox"
        checked={!!checks[id]}
        onChange={() => toggle(id)}
        className="print-checkbox w-4 h-4 rounded border-2 border-gray-400 accent-primary cursor-pointer"
      />
    </td>
  );

  const { data, isLoading, error } = useQuery<RawMaterialsData>({
    queryKey: ["raw-materials", planId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/production-plans/${planId}/raw-materials`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch raw materials");
      return res.json();
    },
  });

  const toggleExpand = (idx: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleCreateOrder = async () => {
    setCreatingOrder(true);
    try {
      const res = await fetch(`${BASE}/api/production-plans/${planId}/raw-materials/create-order`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Order creation failed", description: err.error ?? "Unknown error", variant: "destructive" });
        return;
      }
      const result = await res.json();
      setOrderResult(result);
      const parts: string[] = [];
      if (result.ordersCreated > 0) parts.push(`${result.ordersCreated} created`);
      if (result.ordersUpdated > 0) parts.push(`${result.ordersUpdated} updated`);
      toast({ title: `Supplier orders: ${parts.join(", ")}` });
    } catch {
      toast({ title: "Network error", description: "Could not create orders", variant: "destructive" });
    } finally {
      setCreatingOrder(false);
    }
  };

  return (
    <div data-print-target className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 overflow-y-auto py-6 px-4 print:block print:p-0 print:bg-white print:overflow-visible">
      <div className="bg-card border border-border rounded-2xl w-full max-w-3xl shadow-2xl print:shadow-none print:border-0 print:rounded-none print:max-w-none print:w-full">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border print:border-b-2 print:border-black">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2 print:text-xl">
              <FlaskConical className="w-5 h-5 text-primary print:hidden" />
              Raw Materials Manifest
            </h2>
            {data && (
              <p className="text-sm text-muted-foreground print:text-black print:text-sm">
                {data.planName} · {format(parseISO(data.planDate), "EEEE d MMMM yyyy")}
                {data.batchNumber && <span className="ml-2 font-mono">Batch #{data.batchNumber}</span>}
              </p>
            )}
            {data?.totalEstimatedCost != null && (
              <div className="mt-1.5 inline-flex items-center gap-2 bg-primary/8 border border-primary/20 rounded-lg px-3 py-1.5 print:bg-gray-100 print:border-gray-400">
                <PoundSterling className="w-3.5 h-3.5 text-primary print:text-black" />
                <span className="text-sm font-bold text-primary print:text-black">
                  £{data.totalEstimatedCost.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-muted-foreground print:text-gray-600">
                  {data.costIsPartial ? "partial raw material cost — some ingredients missing price data" : "estimated raw material cost"}
                </span>
              </div>
            )}
            {showPacked && (
              <p className="text-xs text-primary font-medium mt-0.5 print:block print:text-black hidden">Event mode — Packed column shown</p>
            )}
          </div>
          <div className="flex items-center gap-2 print:hidden flex-wrap justify-end">
            <button
              onClick={() => setShowPacked(v => !v)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg transition-colors font-medium",
                showPacked
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-border hover:bg-secondary/50 text-muted-foreground"
              )}
              title="Toggle Packed column (for events)"
            >
              <Package className="w-3.5 h-3.5" />
              {showPacked ? "Event mode on" : "Event mode"}
            </button>
            <button
              onClick={() => { onClose(); navigate(`/orders?planId=${planId}`); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              Create Orders
            </button>
            <button
              onClick={() => {
                document.body.classList.add("printing-manifest");
                window.print();
                document.body.classList.remove("printing-manifest");
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary/50 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              Print / Save PDF
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 print:p-4 print:space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading manifest...
            </div>
          )}

          {error && (
            <div className="text-center py-12 text-red-600">
              Failed to load raw materials. Please try again.
            </div>
          )}

          {data && data.recipes.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No ingredients found. Make sure the plan has recipes with batch targets set.
            </div>
          )}

          {data && data.recipes.length > 0 && (
            <>
              {/* Per-recipe breakdown */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground print:text-black">Per Recipe Breakdown</h3>
                {data.recipes.map((recipe, recipeIdx) => (
                  <div key={recipe.recipeId} className="print-avoid-break border border-border rounded-xl overflow-hidden print:border print:border-black print:rounded-none">
                    <div className="bg-secondary/30 px-4 py-2.5 flex items-center justify-between print:bg-gray-100">
                      <span className="font-semibold text-sm">{recipe.recipeName}</span>
                      <span className="text-xs text-muted-foreground print:text-black">{recipe.batchesTarget} batch{recipe.batchesTarget !== 1 ? "es" : ""}</span>
                    </div>

                    {/* Direct ingredients */}
                    {recipe.directIngredients.length > 0 && (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-t border-border/40 print:border-gray-200 bg-secondary/10 print:bg-gray-50">
                            <th className="py-1.5 px-4 text-left font-medium text-muted-foreground print:text-black">Ingredient</th>
                            <th className="py-1.5 px-4 text-right font-medium text-muted-foreground print:text-black">Qty</th>
                            <th className="py-1.5 px-2 text-center font-medium text-muted-foreground print:text-black w-12">Ordered</th>
                            <th className="py-1.5 px-2 text-center font-medium text-muted-foreground print:text-black w-12">Prepped</th>
                            {showPacked && <th className="py-1.5 px-2 text-center font-medium text-muted-foreground print:text-black w-12">Packed</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {recipe.directIngredients.map(ing => (
                            <tr key={ing.ingredientId} className="border-t border-border/40 print:border-gray-200">
                              <td className="py-1.5 px-4 text-muted-foreground print:text-black">{ing.name}</td>
                              <td className="py-1.5 px-4 text-right font-mono tabular-nums print:text-black">{fmtQty(ing.quantity, ing.unit)}</td>
                              {cb(`r${recipe.recipeId}-i${ing.ingredientId}-ordered`)}
                              {cb(`r${recipe.recipeId}-i${ing.ingredientId}-prepped`)}
                              {showPacked && cb(`r${recipe.recipeId}-i${ing.ingredientId}-packed`)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* Sub-recipes */}
                    {recipe.subRecipes.map((sr, srIdx) => {
                      const key = recipeIdx * 1000 + srIdx;
                      const isExpanded = expanded.has(key);
                      return (
                        <div key={sr.subRecipeId} className="border-t border-border/40 print:border-gray-200">
                          <button
                            onClick={() => toggleExpand(key)}
                            className="w-full flex items-center justify-between px-4 py-2 bg-amber-50/50 dark:bg-amber-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors text-left print:pointer-events-none"
                          >
                            <span className="text-xs font-medium text-amber-800 dark:text-amber-300 print:text-black">
                              {sr.name} <span className="font-normal text-muted-foreground print:text-gray-600">(sub-recipe)</span>
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono tabular-nums text-amber-700 dark:text-amber-400 print:text-black">{fmtQty(sr.totalWeightRequired, sr.unit)}</span>
                              <span className="print:hidden">
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                              </span>
                            </div>
                          </button>
                          <div className={cn("overflow-hidden transition-all", isExpanded ? "max-h-screen" : "max-h-0 print:max-h-screen")}>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-t border-border/20 print:border-gray-100 bg-secondary/5">
                                  <th className="py-1 pl-8 pr-4 text-left font-medium text-muted-foreground print:text-black">Component</th>
                                  <th className="py-1 px-4 text-right font-medium text-muted-foreground print:text-black">Qty</th>
                                  <th className="py-1 px-2 text-center font-medium text-muted-foreground print:text-black w-12">Ordered</th>
                                  <th className="py-1 px-2 text-center font-medium text-muted-foreground print:text-black w-12">Prepped</th>
                                  {showPacked && <th className="py-1 px-2 text-center font-medium text-muted-foreground print:text-black w-12">Packed</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {sr.components.map(comp => (
                                  <tr key={comp.ingredientId} className="border-t border-border/30 print:border-gray-100">
                                    <td className="py-1.5 pl-8 pr-4 text-muted-foreground print:text-gray-700">↳ {comp.name}</td>
                                    <td className="py-1.5 px-4 text-right font-mono tabular-nums print:text-black">{fmtQty(comp.quantity, comp.unit)}</td>
                                    {cb(`r${recipe.recipeId}-sr${sr.subRecipeId}-i${comp.ingredientId}-ordered`)}
                                    {cb(`r${recipe.recipeId}-sr${sr.subRecipeId}-i${comp.ingredientId}-prepped`)}
                                    {showPacked && cb(`r${recipe.recipeId}-sr${sr.subRecipeId}-i${comp.ingredientId}-packed`)}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Grand totals */}
              <div className="print-avoid-break border border-border rounded-xl overflow-hidden print:border print:border-black print:rounded-none">
                <div className="bg-primary/10 px-4 py-2.5 print:bg-gray-200">
                  <h3 className="text-sm font-bold">Total Requirements (All Recipes)</h3>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-secondary/20 border-b border-border print:border-gray-300">
                      <th className="py-2 px-4 text-left font-medium text-muted-foreground print:text-black">Ingredient</th>
                      <th className="py-2 px-4 text-right font-medium text-muted-foreground print:text-black">Total Required</th>
                      <th className="py-2 px-4 text-right font-medium text-muted-foreground print:text-black">Est. Cost</th>
                      <th className="py-2 px-2 text-center font-medium text-muted-foreground print:text-black w-14">Ordered</th>
                      <th className="py-2 px-2 text-center font-medium text-muted-foreground print:text-black w-14">Prepped</th>
                      {showPacked && <th className="py-2 px-2 text-center font-medium text-muted-foreground print:text-black w-14">Packed</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.totals.map(ing => (
                      <tr key={ing.ingredientId} className="border-t border-border/40 print:border-gray-200">
                        <td className="py-1.5 px-4 print:text-black">{ing.name}</td>
                        <td className="py-1.5 px-4 text-right font-mono tabular-nums font-medium print:text-black">{fmtQty(ing.quantity, ing.unit)}</td>
                        <td className="py-1.5 px-4 text-right font-mono tabular-nums text-muted-foreground print:text-black">
                          {ing.estimatedCost != null ? `£${ing.estimatedCost.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                        </td>
                        {cb(`total-i${ing.ingredientId}-ordered`)}
                        {cb(`total-i${ing.ingredientId}-prepped`)}
                        {showPacked && cb(`total-i${ing.ingredientId}-packed`)}
                      </tr>
                    ))}
                    {data.totalEstimatedCost != null && (
                      <tr className="border-t-2 border-border print:border-gray-400 bg-primary/5 print:bg-gray-50 font-bold">
                        <td className="py-2 px-4 print:text-black">Total</td>
                        <td className="py-2 px-4 print:text-black" />
                        <td className="py-2 px-4 text-right font-mono tabular-nums text-primary print:text-black">
                          £{data.totalEstimatedCost.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-2" />
                        <td className="py-2 px-2" />
                        {showPacked && <td className="py-2 px-2" />}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Create order section */}
              <div className="print:hidden border border-border rounded-xl p-4 bg-secondary/10 space-y-3">
                <div>
                  <p className="text-sm font-semibold">Create Full Supplier Order</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Generates purchase orders for every ingredient above at the full required quantity — bypasses stock levels and kanban settings entirely.
                  </p>
                </div>

                {orderResult ? (
                  <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/40 p-3 space-y-1">
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                      {orderResult.ordersCreated > 0 && <>{orderResult.ordersCreated} order{orderResult.ordersCreated !== 1 ? "s" : ""} created</>}
                      {orderResult.ordersCreated > 0 && orderResult.ordersUpdated > 0 && ", "}
                      {orderResult.ordersUpdated > 0 && <>{orderResult.ordersUpdated} order{orderResult.ordersUpdated !== 1 ? "s" : ""} updated</>}
                    </p>
                    {orderResult.orders.map(o => (
                      <p key={o.orderId} className="text-xs text-emerald-700 dark:text-emerald-400">
                        PO #{o.orderId} — {o.supplierName} ({o.lineCount} line{o.lineCount !== 1 ? "s" : ""}) [{o.action}]
                      </p>
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={handleCreateOrder}
                    disabled={creatingOrder}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {creatingOrder ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                    {creatingOrder ? "Creating Orders…" : "Create Full Order"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Plan Detail View
// ──────────────────────────────────────────────────────────────────────────────
const STATION_BUTTONS = [
  { key: "dough_prep", label: "Dough Prep", icon: Layers, color: "text-amber-600 bg-amber-50 dark:bg-amber-900/20" },
  { key: "dough_sheeting", label: "Sheeting", icon: Layers, color: "text-amber-500 bg-amber-50 dark:bg-amber-900/20" },
  { key: "prep", label: "Prep", icon: Salad, color: "text-green-500 bg-green-50 dark:bg-green-900/20" },
  { key: "mixing", label: "Mixing & Cooking", icon: Waves, color: "text-blue-500 bg-blue-50 dark:bg-blue-900/20" },
  { key: "building_1", label: "Building Table 1", icon: Construction, color: "text-orange-500 bg-orange-50 dark:bg-orange-900/20" },
  { key: "building_2", label: "Building Table 2", icon: Construction, color: "text-orange-400 bg-orange-50 dark:bg-orange-900/20" },
  { key: "ovens", label: "Ovens", icon: Flame, color: "text-red-500 bg-red-50 dark:bg-red-900/20" },
  { key: "wrapping", label: "Wrapping", icon: Gift, color: "text-purple-500 bg-purple-50 dark:bg-purple-900/20" },
  { key: "packing", label: "Packing", icon: Box, color: "text-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" },
] as const;

interface ValidationWarning {
  level: "error" | "warning" | "info";
  recipe: string;
  field: string;
  message: string;
  expected?: number | string;
  actual?: number | string;
}

interface ValidationRecipeBreakdown {
  recipeName: string;
  batchesTarget: number;
  portionsPerBatch: number;
  packSize: number;
  totalPortions: number;
  totalPacks: number;
  ingredients: Array<{
    ingredientName: string;
    recipeQtyPerPortion: number;
    qtyPerBatch: number;
    totalQtyForPlan: number;
    unit: string;
  }>;
}

interface ValidationResult {
  planId: number;
  planName: string;
  totalBatches: number;
  totalPortions: number;
  totalPacks: number;
  recipeBreakdowns: ValidationRecipeBreakdown[];
  ingredientTotals: Array<{ ingredientName: string; unit: string; totalQty: number; recipes: string[] }>;
  warnings: ValidationWarning[];
  valid: boolean;
}

interface PlanDetailProps {
  planId: number;
  onBack: () => void;
}

function PlanDetail({ planId, onBack }: PlanDetailProps) {
  const { data: plan, isLoading, refetch } = useGetProductionPlan(planId) as {
    data: ProductionPlanDetail | undefined;
    isLoading: boolean;
    refetch: () => void;
  };
  const { updatePlan, deletePlan } = useAppMutations();
  const queryClient = useQueryClient();
  const { state: authState } = useAuth();
  const userRole = authState.status === "authenticated" ? authState.user.role : undefined;
  const canManageOrders = userRole === "admin" || userRole === "manager";
  const canEditPlan = userRole === "admin" || userRole === "manager";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmResync, setConfirmResync] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resyncLoading, setResyncLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [isEditingDraft, setIsEditingDraft] = useState(false);
  const [showManifest, setShowManifest] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [validationData, setValidationData] = useState<ValidationResult | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [regeneratingOrders, setRegeneratingOrders] = useState(false);
  const [, navigate] = useLocation();
  const { data: stationActivity } = useGetStationActivity(planId, {
    query: { queryKey: getGetStationActivityQueryKey(planId), refetchInterval: 10000 },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading plan...
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        Plan not found.
        <button onClick={onBack} className="block mx-auto mt-2 text-primary hover:underline text-sm">
          ← Back to plans
        </button>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[plan.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
  const StatusIcon = statusConfig.icon;
  const totalBatchesTarget = plan.items?.reduce((s, it) => s + (it.batchesTarget ?? 0), 0) ?? 0;
  const totalBatchesComplete = plan.items?.reduce((s, it) => s + (it.batchesComplete ?? 0), 0) ?? 0;
  const totalPacks = plan.items?.reduce((s, it) => s + (it.batchesTarget ?? 0) * (it.portionsPerBatch ?? 10) / (it.packSize ?? 2), 0) ?? 0;
  const progress = totalBatchesTarget > 0 ? Math.round((totalBatchesComplete / totalBatchesTarget) * 100) : 0;

  const handleValidate = async () => {
    setValidationLoading(true);
    try {
      const resp = await fetch(`/api/production-plans/${planId}/validate`, { credentials: "include" });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => null);
        throw new Error(errBody?.detail ?? errBody?.error ?? `Validation failed (${resp.status})`);
      }
      const data: ValidationResult = await resp.json();
      setValidationData(data);
      setShowValidation(true);
    } catch (err) {
      toast({ title: "Validation failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setValidationLoading(false);
    }
  };

  const handleStatusChange = (newStatus: string) => {
    updatePlan.mutate({ id: planId, data: { status: newStatus as PlanStatus } });
  };

  const handleResync = async () => {
    setResyncLoading(true);
    try {
      const resp = await fetch(`/api/production-plans/${planId}/resync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirmed: true }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Resync failed");
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey;
        return Array.isArray(key) && typeof key[0] === "string" && key[0].includes(`/api/production-plans/${planId}`);
      }});
      queryClient.invalidateQueries({ queryKey: getListProductionPlansQueryKey() });
      refetch();
      toast({ title: "Resync complete", description: `${data.message} All station ingredient weights have been recalculated from the latest recipe data.` });
    } catch (err) {
      toast({ title: "Resync failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setResyncLoading(false);
      setConfirmResync(false);
    }
  };

  const handleReset = async () => {
    setResetLoading(true);
    try {
      const resp = await fetch(`/api/production-plans/${planId}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirmed: true }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Reset failed");
      toast({ title: "Plan reset", description: data.message });
      refetch();
    } catch (err) {
      toast({ title: "Reset failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setResetLoading(false);
      setConfirmReset(false);
    }
  };

  const handleRegenerateOrders = async () => {
    setRegeneratingOrders(true);
    try {
      const resp = await fetch("/api/orders/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ planId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Regenerate failed");
      toast({
        title: "Orders regenerated",
        description: `Deleted ${data.deletedDraftOrders} draft order(s), created ${data.createdOrders} new order(s).`,
      });
    } catch (err) {
      toast({ title: "Regenerate failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setRegeneratingOrders(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to plans
          </button>
          <h1 className="font-display text-2xl font-bold">{plan.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-muted-foreground text-sm flex items-center gap-1">
              <CalendarDays className="w-4 h-4" />
              {format(parseISO(plan.planDate), "EEEE d MMMM yyyy")}
            </span>
            <span className="text-muted-foreground text-sm font-mono">
              Batch #{plan.batchNumber ?? julianBatchNumber(plan.planDate)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1", statusConfig.color)}>
            <StatusIcon className="w-3.5 h-3.5" />
            {statusConfig.label}
          </span>

          {plan.status === "draft" && canEditPlan && (
            <>
              <button
                onClick={() => setIsEditingDraft(true)}
                className="px-3 py-1.5 text-xs border border-border bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors font-medium flex items-center gap-1"
              >
                <ClipboardList className="w-3.5 h-3.5" />
                Edit Draft
              </button>
              <button
                onClick={() => handleStatusChange("active")}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Activate & Lock
              </button>
            </>
          )}
          {plan.status === "active" && (
            <button
              onClick={() => handleStatusChange("complete")}
              className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
            >
              Mark Complete
            </button>
          )}
          <button
            onClick={() => setShowManifest(true)}
            className="px-3 py-1.5 text-xs border border-border bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors font-medium flex items-center gap-1"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            Raw Materials
          </button>
          <button
            onClick={() => navigate(`/orders?planId=${planId}`)}
            className="px-3 py-1.5 text-xs border border-border bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors font-medium flex items-center gap-1"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            View Orders
          </button>
          {canManageOrders && (
            <button
              onClick={handleRegenerateOrders}
              disabled={regeneratingOrders}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium flex items-center gap-1"
            >
              {regeneratingOrders ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Regenerate Orders
            </button>
          )}
          <button
            onClick={handleValidate}
            disabled={validationLoading}
            className="px-3 py-1.5 text-xs border border-border bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors font-medium flex items-center gap-1"
          >
            {validationLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            Validate
          </button>
          {plan.status !== "complete" && (
            <button
              onClick={() => setConfirmReset(true)}
              className="px-3 py-1.5 text-xs text-orange-600 hover:text-orange-700 border border-orange-200 dark:border-orange-900/40 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors font-medium flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Plan
            </button>
          )}
          {plan.status !== "complete" && canEditPlan && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-3 py-1.5 text-xs text-red-600 hover:text-red-700 border border-red-200 dark:border-red-900/40 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Progress summary */}
      {totalBatchesTarget > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Progress</span>
            <span className="text-sm text-muted-foreground">
              {totalBatchesComplete} / {totalBatchesTarget} batches ({progress}%)
            </span>
          </div>
          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                progress >= 100 ? "bg-emerald-500" : "bg-primary"
              )}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Validation results */}
      {showValidation && validationData && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              Plan Validation
            </h2>
            <button onClick={() => setShowValidation(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {validationData.valid && validationData.warnings.length === 0 ? (
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium text-sm">All checks passed — quantities are consistent with recipes.</span>
              </div>
            ) : (
              <div className="space-y-2">
                {validationData.warnings.map((w, i) => (
                  <div key={i} className={cn(
                    "flex items-start gap-2 text-sm p-2 rounded-lg border",
                    w.level === "error" ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200" :
                    "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
                  )}>
                    {w.level === "error" ? <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                    <div>
                      {w.field && w.field !== w.recipe && (
                        <span className="font-semibold block">{w.field}</span>
                      )}
                      <span className="text-xs opacity-75">Used in: {w.recipe}</span>
                      <span className="block mt-0.5">{w.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-secondary/30 rounded-xl p-3">
              <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider mb-2">Plan Totals</h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-lg font-bold tabular-nums">{validationData.totalBatches}</p>
                  <p className="text-xs text-muted-foreground">Batches</p>
                </div>
                <div>
                  <p className="text-lg font-bold tabular-nums">{validationData.totalPortions}</p>
                  <p className="text-xs text-muted-foreground">Portions</p>
                </div>
                <div>
                  <p className="text-lg font-bold tabular-nums">{validationData.totalPacks}</p>
                  <p className="text-xs text-muted-foreground">Packs</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">Recipe Breakdown</h3>
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-secondary/30 border-b border-border text-xs text-muted-foreground">
                      <th className="py-2 px-3 text-left font-medium">Recipe</th>
                      <th className="py-2 px-3 text-center font-medium">Batches</th>
                      <th className="py-2 px-3 text-center font-medium">× Portions</th>
                      <th className="py-2 px-3 text-center font-medium">= Total Portions</th>
                      <th className="py-2 px-3 text-center font-medium">÷ Pack Size</th>
                      <th className="py-2 px-3 text-center font-medium">= Packs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validationData.recipeBreakdowns.map((rb, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="py-2 px-3 font-medium">{rb.recipeName}</td>
                        <td className="py-2 px-3 text-center tabular-nums">{rb.batchesTarget}</td>
                        <td className="py-2 px-3 text-center tabular-nums">{rb.portionsPerBatch}</td>
                        <td className="py-2 px-3 text-center tabular-nums font-medium">{rb.totalPortions}</td>
                        <td className="py-2 px-3 text-center tabular-nums">{rb.packSize}</td>
                        <td className="py-2 px-3 text-center tabular-nums font-medium">{rb.totalPacks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">Ingredient Totals (cooked/recipe weight)</h3>
              <div className="bg-card border border-border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="bg-secondary/30 border-b border-border text-xs text-muted-foreground">
                      <th className="py-2 px-3 text-left font-medium">Ingredient</th>
                      <th className="py-2 px-3 text-right font-medium">Total Qty</th>
                      <th className="py-2 px-3 text-left font-medium">Used By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validationData.ingredientTotals
                      .sort((a, b) => a.ingredientName.localeCompare(b.ingredientName))
                      .map((ing, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="py-1.5 px-3 font-medium">{ing.ingredientName}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">
                          {ing.unit === "g" && ing.totalQty >= 1000 ? `${(ing.totalQty / 1000).toFixed(3)} kg` : `${ing.totalQty.toFixed(ing.unit === "kg" ? 3 : 1)} ${ing.unit}`}
                        </td>
                        <td className="py-1.5 px-3 text-xs text-muted-foreground">{[...new Set(ing.recipes)].join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Station navigation */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h2 className="font-bold text-base mb-3 flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-primary" />
          Enter Station
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {STATION_BUTTONS.map(s => {
            const Icon = s.icon;
            const isBuildingStation = s.key === "building_1" || s.key === "building_2";
            const stationComplete = totalBatchesTarget > 0 && totalBatchesComplete >= totalBatchesTarget;
            const stationInProgress = !stationComplete && totalBatchesComplete > 0;
            const activeUsers = (stationActivity as Record<string, number> | undefined)?.[s.key] ?? 0;
            return (
              <button
                key={s.key}
                onClick={() => navigate(`/plans/${planId}/station/${s.key}`)}
                className="flex flex-col items-center justify-center gap-4 p-6 min-h-[160px] border-2 border-border rounded-2xl hover:border-primary hover:bg-secondary/40 hover:shadow-md active:scale-[0.97] transition-all group relative"
              >
                {/* Active user badge */}
                {activeUsers > 0 && (
                  <span
                    className="absolute top-3 right-3 min-w-[24px] h-6 px-2 rounded-full bg-blue-500 text-white text-sm font-bold flex items-center justify-center"
                    title={`${activeUsers} active user${activeUsers !== 1 ? "s" : ""} today`}
                  >
                    {activeUsers}
                  </span>
                )}
                {isBuildingStation && stationComplete && activeUsers === 0 && (
                  <span className="absolute top-3 right-3 w-3 h-3 rounded-full bg-emerald-500" title="Complete" />
                )}
                {isBuildingStation && stationInProgress && activeUsers === 0 && (
                  <span className="absolute top-3 right-3 w-3 h-3 rounded-full bg-amber-400" title="In progress" />
                )}
                <div className={cn("w-20 h-20 rounded-2xl flex items-center justify-center", s.color)}>
                  <Icon className="w-10 h-10" />
                </div>
                <span className="text-lg font-extrabold text-center leading-snug text-black dark:text-white transition-colors">
                  {s.label}
                </span>
                {isBuildingStation && totalBatchesTarget > 0 && (
                  <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", stationComplete ? "bg-emerald-500" : "bg-primary")}
                      style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                  </div>
                )}
                {!isBuildingStation && activeUsers === 0 && (
                  <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Items table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" />
            Production Items
          </h2>
          <span className="text-xs text-muted-foreground">{plan.items?.length ?? 0} recipes · {totalBatchesTarget} batches · {totalPacks.toLocaleString()} packs</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/20 border-b border-border">
              <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">#</th>
              <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">Recipe</th>
              <th className="py-2.5 px-4 text-center font-medium text-muted-foreground">Batches</th>
              <th className="py-2.5 px-4 text-center font-medium text-muted-foreground">Packs</th>
              <th className="py-2.5 px-4 text-center font-medium text-muted-foreground">Done</th>
              <th className="py-2.5 px-4 text-center font-medium text-muted-foreground">Wonky</th>
              <th className="py-2.5 px-4 text-right font-medium text-muted-foreground">Tin Size</th>
              <th className="py-2.5 px-4 text-right font-medium text-muted-foreground">Tins</th>
              <th className="py-2.5 px-4 text-center font-medium text-muted-foreground">Status</th>
              <th className="py-2.5 px-4 text-center font-medium text-muted-foreground">Progress</th>
            </tr>
          </thead>
          <tbody>
            {(plan.items ?? []).map(item => {
              const itemProgress = (item.batchesTarget ?? 0) > 0
                ? Math.round(((item.batchesComplete ?? 0) / (item.batchesTarget ?? 0)) * 100)
                : 0;
              const itemStatusConfig = {
                pending: { color: "bg-secondary text-secondary-foreground", label: "Pending" },
                "in-progress": { color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", label: "In Progress" },
                complete: { color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", label: "Done" },
              }[item.status ?? "pending"] ?? { color: "bg-secondary text-secondary-foreground", label: item.status };

              const tinCount = (() => { const b = item.batchesTarget ?? 0; if (!item.maxBatchesPerTin || b <= 0) return null; const raw = Math.ceil(b / item.maxBatchesPerTin); return b > 5 ? Math.max(2, raw) : raw; })();

              return (
                <tr key={item.id} className="border-b border-border/50 last:border-0">
                  <td className="py-3 px-4 text-muted-foreground text-sm">{item.orderPosition}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium" style={item.recipeColor ? { color: item.recipeColor } : undefined}>{item.recipeName ?? `Recipe #${item.recipeId}`}</span>
                      {item.sopUrl && (
                        <a href={item.sopUrl} target="_blank" rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary transition-colors" title="Open SOP">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-center font-medium">{item.batchesTarget ?? 0}</td>
                  <td className="py-3 px-4 text-center font-mono text-muted-foreground">
                    {((item.batchesTarget ?? 0) * (item.portionsPerBatch ?? 10) / (item.packSize ?? 2)).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-center">{item.batchesComplete ?? 0}</td>
                  <td className="py-3 px-4 text-center">
                    {(item.wonlyCount ?? 0) > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">{item.wonlyCount}</span>
                    ) : (
                      <span className="text-muted-foreground opacity-40">0</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right text-muted-foreground text-xs">
                    {item.tinSize ?? <span className="opacity-40">—</span>}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {tinCount !== null ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">{tinCount}</span>
                    ) : (
                      <span className="text-muted-foreground opacity-40">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs", itemStatusConfig.color)}>
                      {itemStatusConfig.label}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", itemProgress >= 100 ? "bg-emerald-500" : "bg-primary")}
                          style={{ width: `${Math.min(itemProgress, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-9 text-right">{itemProgress}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {totalBatchesTarget > 0 && (
            <tfoot>
              <tr className="bg-secondary/10 border-t border-border font-medium text-sm">
                <td colSpan={2} className="py-2.5 px-4 text-right text-muted-foreground">Totals</td>
                <td className="py-2.5 px-4 text-center">{totalBatchesTarget}</td>
                <td className="py-2.5 px-4 text-center font-mono">{totalPacks.toLocaleString()}</td>
                <td className="py-2.5 px-4 text-center">{totalBatchesComplete}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {plan.notes && (
        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-xl p-4 text-sm">
          <p className="font-medium text-amber-800 dark:text-amber-300 mb-1">Notes</p>
          <p className="text-amber-700 dark:text-amber-400">{plan.notes}</p>
        </div>
      )}

      {/* Resync confirmation */}
      {confirmResync && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-amber-600" />
              Resync Recipes?
            </h3>
            <p className="text-muted-foreground text-sm mb-2">
              This will refresh all recipe data for this plan:
            </p>
            <ul className="text-sm text-muted-foreground list-disc ml-5 mb-2 space-y-0.5">
              <li>Update tin size, max batches per tin, and SOP URL</li>
              <li>Recalculate ingredient weights for all stations (prep, filling mix, assembly, dough, packing)</li>
              <li>Refresh raw material requirements</li>
            </ul>
            {plan.status !== "draft" && (
              <p className="text-amber-600 text-sm font-medium mb-4">
                This plan is currently {plan.status}. Resyncing may affect in-progress work.
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmResync(false)}
                className="px-4 py-2 text-sm border border-border rounded-xl hover:bg-secondary/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResync}
                disabled={resyncLoading}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-xl hover:bg-amber-700 transition-colors flex items-center gap-1"
              >
                {resyncLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Resync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset confirmation */}
      {confirmReset && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-orange-600" />
              Reset Production Plan?
            </h3>
            <p className="text-muted-foreground text-sm mb-2">
              This will <strong>zero all progress</strong> on "{plan.name}":
            </p>
            <ul className="text-sm text-muted-foreground list-disc ml-5 mb-2 space-y-0.5">
              <li>All batch completions deleted</li>
              <li>All prep completions deleted</li>
              <li>Station breaks, temperature records, and oven events deleted</li>
              <li>Fridge, freezer, and prep fridge counts zeroed</li>
              <li>Wonky counts and extra packs zeroed</li>
              <li>Plan set back to Draft</li>
            </ul>
            <p className="text-orange-600 text-sm font-semibold mb-4">
              This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmReset(false)}
                className="px-4 py-2 text-sm border border-border rounded-xl hover:bg-secondary/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={resetLoading}
                className="px-4 py-2 text-sm bg-orange-600 text-white rounded-xl hover:bg-orange-700 transition-colors flex items-center gap-1"
              >
                {resetLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Reset Plan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="font-semibold text-lg mb-2">Delete Plan?</h3>
            <p className="text-muted-foreground text-sm mb-4">
              This will permanently delete "{plan.name}" and all its items. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 text-sm border border-border rounded-xl hover:bg-secondary/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  deletePlan.mutate({ id: planId }, { onSuccess: onBack });
                  setConfirmDelete(false);
                }}
                className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-xl hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {isEditingDraft && plan.status === "draft" && (
        <EditDraftDialog
          plan={plan}
          open={isEditingDraft}
          onClose={() => setIsEditingDraft(false)}
          onSaved={() => {
            setIsEditingDraft(false);
            refetch();
          }}
        />
      )}

      {showManifest && (
        <RawMaterialsManifest
          planId={planId}
          planName={plan.name}
          onClose={() => setShowManifest(false)}
        />
      )}

    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Plans List
// ──────────────────────────────────────────────────────────────────────────────
interface PlansListProps {
  onViewPlan: (planId: number) => void;
  onCreatePlan: () => void;
  onGoToday: () => void;
  currentDate: Date;
  setCurrentDate: (d: Date) => void;
  selectedDate: Date;
  setSelectedDate: (d: Date) => void;
}

function PlansList({ onViewPlan, onCreatePlan, onGoToday, currentDate, setCurrentDate, selectedDate, setSelectedDate }: PlansListProps) {
  const { data: plans, isLoading } = useListProductionPlans();
  const { deletePlan } = useAppMutations();
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const { state: listAuthState } = useAuth();
  const listUserRole = listAuthState.status === "authenticated" ? listAuthState.user.role : undefined;
  const canEditPlanList = listUserRole === "admin" || listUserRole === "manager";

  const weekStart = useMemo(() => startOfWeek(currentDate, { weekStartsOn: 1 }), [currentDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const plansByDate = useMemo(() => {
    const map: Record<string, typeof plans> = {};
    for (const plan of plans ?? []) {
      const key = plan.planDate;
      if (!map[key]) map[key] = [];
      map[key]!.push(plan);
    }
    return map;
  }, [plans]);

  const selectedDateKey = format(selectedDate, "yyyy-MM-dd");
  const selectedDayPlans = plansByDate[selectedDateKey] ?? [];

  const prevWeek = () => setCurrentDate(addDays(currentDate, -7));
  const nextWeek = () => setCurrentDate(addDays(currentDate, 7));

  const selectDay = (day: Date) => {
    setSelectedDate(day);
    const dayWeekStart = startOfWeek(day, { weekStartsOn: 1 });
    if (format(dayWeekStart, "yyyy-MM-dd") !== format(weekStart, "yyyy-MM-dd")) {
      setCurrentDate(day);
    }
  };

  const handleDatePicker = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    selectDay(parseISO(e.target.value));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading plans...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Weekly calendar */}
      <div className="glass-panel rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <button onClick={prevWeek} className="p-2 rounded-lg hover:bg-secondary/50 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-muted-foreground">
              {format(weekStart, "d MMM")} — {format(addDays(weekStart, 6), "d MMM yyyy")}
            </span>
            <label className="relative cursor-pointer flex items-center" title="Jump to date">
              <Calendar className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
              <input
                type="date"
                value={selectedDateKey}
                onChange={handleDatePicker}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
            </label>
          </div>
          <button onClick={nextWeek} className="p-2 rounded-lg hover:bg-secondary/50 transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-2">
          {weekDays.map(day => {
            const dateKey = format(day, "yyyy-MM-dd");
            const dayPlans = plansByDate[dateKey] ?? [];
            const today = isToday(day);
            const selected = isSameDay(day, selectedDate);
            const isComplete = dayPlans.length > 0 && dayPlans.every(p => p.status === "complete" || p.status === "completed");
            const hasPlan = dayPlans.length > 0;
            const isInProgress = hasPlan && !isComplete;

            return (
              <button
                key={dateKey}
                onClick={() => selectDay(day)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl py-3 px-1 transition-all border",
                  selected
                    ? "bg-primary text-primary-foreground border-primary shadow-md"
                    : today
                    ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
                    : "border-border hover:bg-secondary/50"
                )}
              >
                <span className={cn(
                  "text-xs font-medium uppercase tracking-wide",
                  selected ? "text-primary-foreground/70" : today ? "text-primary" : "text-muted-foreground"
                )}>
                  {format(day, "EEE")}
                </span>
                <span className={cn(
                  "text-lg font-bold leading-none",
                  selected ? "text-primary-foreground" : today ? "text-primary" : "text-foreground"
                )}>
                  {format(day, "d")}
                </span>
                {hasPlan ? (
                  <span className={cn(
                    "w-2 h-2 rounded-full",
                    selected
                      ? "bg-white/70"
                      : isComplete
                      ? "bg-emerald-500"
                      : isInProgress
                      ? "bg-amber-500"
                      : "bg-primary"
                  )} />
                ) : (
                  <span className="h-2" />
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 pt-1 border-t border-border/50">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Complete
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> In progress
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-border border border-border" /> No plan
          </span>
        </div>
      </div>

      {/* Selected day plans */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">
            {isToday(selectedDate) ? "Today" : format(selectedDate, "EEEE, d MMMM")}
            {selectedDayPlans.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {selectedDayPlans.length} plan{selectedDayPlans.length !== 1 ? "s" : ""}
              </span>
            )}
          </h2>
        </div>

        {selectedDayPlans.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card flex flex-col items-center justify-center py-14 text-muted-foreground">
            <CalendarDays className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm font-medium">No production plan for this day</p>
            <p className="text-xs mt-1 opacity-70">Select another day or create a new plan</p>
            <button
              onClick={onCreatePlan}
              className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover-lift flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Create Plan
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {selectedDayPlans.map(plan => {
              const statusConfig = STATUS_CONFIG[plan.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
              const StatusIcon = statusConfig.icon;
              // The list endpoint now returns a lightweight items array
              // (id/recipeId/recipeName/recipeColor/batchesTarget/
              // orderPosition). This field isn't in the generated
              // ProductionPlan type yet, so read it through a local cast.
              const planItems = (plan as unknown as {
                items?: Array<{ id: number; recipeId: number; recipeName: string; recipeColor: string | null; batchesTarget: number; orderPosition: number }>
              }).items ?? [];

              return (
                <div
                  key={plan.id}
                  className="rounded-xl p-4 transition-all cursor-pointer group relative bg-card border border-border hover:border-primary/30 hover:shadow-sm"
                  onClick={() => onViewPlan(plan.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate transition-colors group-hover:text-primary">
                          {plan.name}
                        </h3>
                        <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 flex-shrink-0", statusConfig.color)}>
                          <StatusIcon className="w-3 h-3" />
                          {statusConfig.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                        <span className="font-mono text-xs">
                          Batch #{plan.batchNumber ?? julianBatchNumber(plan.planDate)}
                        </span>
                        {plan.itemCount > 0 && (
                          <span className="text-xs">
                            {plan.itemCount} recipe{plan.itemCount !== 1 ? "s" : ""}
                            {plan.totalBatchesTarget > 0 && ` · ${plan.totalBatchesTarget} batches`}
                          </span>
                        )}
                        {plan.notes && (
                          <span className="text-xs truncate max-w-48 italic">{plan.notes}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      {canEditPlanList && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setDeleteTarget({ id: plan.id, name: plan.name });
                          }}
                          className="opacity-0 group-hover:opacity-100 p-2 text-muted-foreground hover:text-destructive transition-all rounded-lg hover:bg-destructive/10"
                          title="Delete plan"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline recipe breakdown — single column, colour-coded
                      using each recipe's own colour (same pattern as the
                      dashboard recipe list and the plan detail view) so
                      the user can flick between days and instantly read
                      the lineup at a glance. A single "Batches" header
                      is printed once above the count column instead of
                      repeating the word on every row. */}
                  {planItems.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/60">
                      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        <span>Recipe</span>
                        <span>Batches</span>
                      </div>
                      <div className="space-y-1">
                        {planItems.map(item => {
                          const colorStyle = item.recipeColor ? { color: item.recipeColor } : undefined;
                          return (
                            <div
                              key={item.id}
                              className="flex items-baseline justify-between gap-3 text-sm min-w-0"
                            >
                              <span className="truncate font-medium" style={colorStyle}>
                                {item.recipeName}
                              </span>
                              <span className="tabular-nums font-bold whitespace-nowrap" style={colorStyle}>
                                {item.batchesTarget}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteTarget(null)}>
          <div className="bg-card border border-border rounded-xl p-6 shadow-xl max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-2">Delete Plan?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              This will permanently delete "{deleteTarget.name}" and all its items. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-secondary/60 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  deletePlan.mutate({ id: deleteTarget.id });
                  setDeleteTarget(null);
                }}
                className="px-4 py-2 text-sm rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────────────────
export default function ProductionPlans() {
  const search = useSearch();
  const initialPlanId = useMemo(() => {
    const params = new URLSearchParams(search);
    const id = params.get("planId");
    return id ? Number(id) : null;
  }, []);

  const [view, setView] = useState<PlanView>(initialPlanId ? "detail" : "list");
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(initialPlanId);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [, navigate] = useLocation();

  const todayDate = useMemo(() => new Date(), []);
  const [currentDate, setCurrentDate] = useState<Date>(todayDate);
  const [selectedDate, setSelectedDate] = useState<Date>(todayDate);

  const handleViewPlan = (planId: number) => {
    setSelectedPlanId(planId);
    setView("detail");
  };

  const handleBack = () => {
    setView("list");
    setSelectedPlanId(null);
  };

  const handlePlanCreated = (planId: number) => {
    setIsCreateOpen(false);
    navigate(`/orders?planId=${planId}`);
  };

  const handleGoToday = () => {
    setCurrentDate(todayDate);
    setSelectedDate(todayDate);
  };

  return (
    <div className="space-y-6">
      {view === "list" && (
        <>
          <PageHeader
            title="Production Plans"
            description="Schedule daily production runs with DPT-calculated batch targets."
            action={
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGoToday}
                  className="px-4 py-2.5 border border-border rounded-xl font-medium flex items-center gap-2 hover:bg-secondary/50 transition-colors text-sm"
                >
                  <Calendar className="w-4 h-4" /> Today
                </button>
                <button
                  onClick={() => setIsCreateOpen(true)}
                  className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 hover-lift flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Create Plan
                </button>
              </div>
            }
          />
          <PlansList
            onViewPlan={handleViewPlan}
            onCreatePlan={() => setIsCreateOpen(true)}
            onGoToday={handleGoToday}
            currentDate={currentDate}
            setCurrentDate={setCurrentDate}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
          />
        </>
      )}

      {view === "detail" && selectedPlanId !== null && (
        <PlanDetail planId={selectedPlanId} onBack={handleBack} />
      )}

      <CreatePlanDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={handlePlanCreated}
        initialDate={selectedDate}
      />
    </div>
  );
}
