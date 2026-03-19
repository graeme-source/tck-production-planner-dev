import { useState, useMemo, useEffect } from "react";
import {
  useListProductionPlans,
  useGetProductionPlan,
  useGetDptCalculator,
} from "@workspace/api-client-react";
import type { DptSuggestion, ProductionPlanDetail } from "@workspace/api-client-react";
type PlanStatus = "draft" | "active" | "prep" | "building" | "complete";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import {
  CalendarDays, Plus, Trash2, ChevronLeft,
  BarChart2, CheckCircle2,
  Loader2, RefreshCw, Info, Package, ClipboardList, ExternalLink,
  Waves, Construction, Flame, Gift, Box, Salad, Layers, Beef,
  ArrowRight,
} from "lucide-react";
import { format, addDays, parseISO, isWeekend } from "date-fns";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

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
// Create Plan Dialog
// ──────────────────────────────────────────────────────────────────────────────
interface CreatePlanDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (planId: number) => void;
}

interface PlanItem {
  recipeId: number;
  recipeName: string;
  included: boolean;
  suggestedBatches: number;
  batchesTarget: number;
  tinCount: number | null;
  maxBatchesPerTin: number | null;
  currentStock: number;
  demand: number;
  portionsPerBatch: number;
  sopUrl: string | null;
}

function CreatePlanDialog({ open, onClose, onCreated }: CreatePlanDialogProps) {
  const nextWorkDay = getNextWorkingDay(new Date());
  const [planDate, setPlanDate] = useState(toLocalDateStr(nextWorkDay));
  const [planName, setPlanName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<PlanItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: suggestions, isLoading: loadingDpt, refetch: refetchDpt } = useGetDptCalculator(
    { date: planDate },
    { query: { enabled: open } }
  );
  const { createPlan } = useAppMutations();

  // Auto-populate name when date changes
  useEffect(() => {
    if (planDate) {
      const d = parseISO(planDate);
      setPlanName(`Production Plan – ${format(d, "EEEE d MMM yyyy")}`);
    }
  }, [planDate]);

  // Sync DPT suggestions into editable items
  useEffect(() => {
    if (!suggestions) return;
    setItems(
      suggestions.map((s: DptSuggestion) => ({
        recipeId: s.recipeId,
        recipeName: s.recipeName ?? `Recipe #${s.recipeId}`,
        included: s.suggestedBatches > 0,
        suggestedBatches: s.suggestedBatches,
        batchesTarget: s.suggestedBatches,
        tinCount: s.tinCount,
        maxBatchesPerTin: s.maxBatchesPerTin,
        currentStock: s.currentStock,
        demand: s.demand,
        portionsPerBatch: s.portionsPerBatch,
        sopUrl: s.sopUrl,
      }))
    );
  }, [suggestions]);

  const recalcTins = (batchesTarget: number, maxBatchesPerTin: number | null): number | null => {
    if (!maxBatchesPerTin || batchesTarget <= 0) return null;
    return Math.ceil(batchesTarget / maxBatchesPerTin);
  };

  const updateItem = (recipeId: number, updates: Partial<PlanItem>) => {
    setItems(prev =>
      prev.map(it => {
        if (it.recipeId !== recipeId) return it;
        const merged = { ...it, ...updates };
        if ("batchesTarget" in updates) {
          merged.tinCount = recalcTins(merged.batchesTarget, merged.maxBatchesPerTin);
        }
        return merged;
      })
    );
  };

  const handleSubmit = async () => {
    const includedItems = items.filter(it => it.included);
    if (includedItems.length === 0) return;

    setIsSubmitting(true);
    try {
      const data = {
        planDate: new Date(planDate + "T00:00:00").toISOString(),
        name: planName || `Plan ${planDate}`,
        notes: notes || undefined,
        items: includedItems.map((it, i) => ({
          recipeId: it.recipeId,
          orderPosition: i + 1,
          batchesTarget: it.batchesTarget,
          batchesComplete: 0,
          wonlyCount: 0,
          status: "pending",
        })),
      };

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
    } catch {
      setIsSubmitting(false);
    }
  };

  const includedCount = items.filter(it => it.included).length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl bg-card border-border rounded-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="pb-4 border-b border-border flex-shrink-0">
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" />
            Create Production Plan
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 p-1">
          {/* Plan metadata */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="text-sm font-medium mb-1 block text-muted-foreground">Production Date</label>
              <input
                type="date"
                value={planDate}
                onChange={e => setPlanDate(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus-ring"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block text-muted-foreground">Plan Name</label>
              <input
                value={planName}
                onChange={e => setPlanName(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus-ring"
                placeholder="Auto-generated from date"
              />
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1 block text-muted-foreground">Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus-ring resize-none"
                placeholder="Optional notes for this plan..."
              />
            </div>
          </div>

          {/* DPT Calculator */}
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-primary" />
              DPT Auto-Calculator
              <span className="text-muted-foreground font-normal text-xs">
                ({includedCount} of {items.length} recipes included)
              </span>
            </h3>
            <button
              onClick={() => refetchDpt()}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>

          {loadingDpt ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Calculating targets...
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground bg-secondary/20 rounded-xl">
              <Info className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No active DPT settings found.</p>
              <p className="text-xs mt-1">Configure DPT settings in Admin Settings first.</p>
            </div>
          ) : (
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-secondary/30 border-b border-border">
                    <th className="w-8 py-2.5 px-3 text-left">
                      <input
                        type="checkbox"
                        checked={items.every(it => it.included)}
                        onChange={e => setItems(prev => prev.map(it => ({ ...it, included: e.target.checked })))}
                        className="rounded border-border"
                      />
                    </th>
                    <th className="py-2.5 px-3 text-left font-medium text-muted-foreground">Recipe</th>
                    <th className="py-2.5 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Stock</th>
                    <th className="py-2.5 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Demand</th>
                    <th className="py-2.5 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Suggested</th>
                    <th className="py-2.5 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Target Batches</th>
                    <th className="py-2.5 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Tins</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr
                      key={it.recipeId}
                      className={cn(
                        "border-b border-border/50 last:border-0 transition-colors",
                        it.included ? "bg-card" : "bg-secondary/20 opacity-60"
                      )}
                    >
                      <td className="py-2.5 px-3">
                        <input
                          type="checkbox"
                          checked={it.included}
                          onChange={e => updateItem(it.recipeId, { included: e.target.checked })}
                          className="rounded border-border"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{it.recipeName}</span>
                          {it.sopUrl && (
                            <a
                              href={it.sopUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-primary transition-colors"
                              title="Open SOP"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {it.portionsPerBatch} portions/batch
                          {it.maxBatchesPerTin ? ` · ${it.maxBatchesPerTin} batches/tin` : ""}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={cn(
                          "text-xs px-2 py-0.5 rounded-full",
                          it.currentStock < it.demand
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        )}>
                          {it.currentStock}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-muted-foreground">
                        {it.demand > 0 ? (
                          <span className="text-amber-600 dark:text-amber-400">{it.demand}</span>
                        ) : (
                          <span className="opacity-40">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right text-muted-foreground">
                        {it.suggestedBatches}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <input
                          type="number"
                          min={0}
                          value={it.batchesTarget}
                          onChange={e => updateItem(it.recipeId, { batchesTarget: Number(e.target.value) })}
                          disabled={!it.included}
                          className="w-20 px-2 py-1 bg-background border border-border rounded-lg text-sm text-right focus-ring disabled:opacity-40"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-muted-foreground">
                        {it.tinCount !== null ? (
                          <span className="text-foreground">{it.tinCount}</span>
                        ) : (
                          <span className="opacity-40">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              Stock ≥ demand
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              Stock &lt; demand (top-up needed)
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              Demand from next 3 dispatches
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-4 flex items-center justify-between flex-shrink-0">
          <div className="text-sm text-muted-foreground">
            Julian batch: <span className="font-mono font-semibold text-foreground">{julianBatchNumber(planDate)}</span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={includedCount === 0 || isSubmitting}
              className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-xl font-medium disabled:opacity-50 flex items-center gap-2 transition-opacity"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create Plan ({includedCount} recipe{includedCount !== 1 ? "s" : ""})
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Plan Detail View
// ──────────────────────────────────────────────────────────────────────────────
const STATION_BUTTONS = [
  { key: "mixing", label: "Mixing & Cooking", icon: Waves, color: "text-blue-500 bg-blue-50 dark:bg-blue-900/20" },
  { key: "building_1", label: "Building Line 1", icon: Construction, color: "text-orange-500 bg-orange-50 dark:bg-orange-900/20" },
  { key: "building_2", label: "Building Line 2", icon: Construction, color: "text-orange-400 bg-orange-50 dark:bg-orange-900/20" },
  { key: "ovens", label: "Ovens", icon: Flame, color: "text-red-500 bg-red-50 dark:bg-red-900/20" },
  { key: "wrapping", label: "Wrapping", icon: Gift, color: "text-purple-500 bg-purple-50 dark:bg-purple-900/20" },
  { key: "packing", label: "Packing", icon: Box, color: "text-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" },
  { key: "dough_prep", label: "Dough Prep", icon: Layers, color: "text-amber-600 bg-amber-50 dark:bg-amber-900/20" },
  { key: "dough_sheeting", label: "Sheeting", icon: Layers, color: "text-amber-500 bg-amber-50 dark:bg-amber-900/20" },
  { key: "prep_veg", label: "Veg Prep", icon: Salad, color: "text-green-500 bg-green-50 dark:bg-green-900/20" },
  { key: "prep_bases", label: "Bases & Mozz", icon: Layers, color: "text-yellow-500 bg-yellow-50 dark:bg-yellow-900/20" },
  { key: "prep_meat", label: "Raw Meat", icon: Beef, color: "text-rose-500 bg-rose-50 dark:bg-rose-900/20" },
] as const;

interface PlanDetailProps {
  planId: number;
  onBack: () => void;
}

function PlanDetail({ planId, onBack }: PlanDetailProps) {
  const { data: plan, isLoading } = useGetProductionPlan(planId) as {
    data: ProductionPlanDetail | undefined;
    isLoading: boolean;
  };
  const { updatePlan, deletePlan } = useAppMutations();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [, navigate] = useLocation();

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
  const progress = totalBatchesTarget > 0 ? Math.round((totalBatchesComplete / totalBatchesTarget) * 100) : 0;

  const handleStatusChange = (newStatus: string) => {
    updatePlan.mutate({ id: planId, data: { status: newStatus as PlanStatus } });
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

          {plan.status === "draft" && (
            <button
              onClick={() => handleStatusChange("active")}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Activate Plan
            </button>
          )}
          {plan.status === "active" && (
            <button
              onClick={() => handleStatusChange("complete")}
              className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
            >
              Mark Complete
            </button>
          )}
          {plan.status !== "complete" && (
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

      {/* Station navigation */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h2 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-primary" />
          Enter Station
        </h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {STATION_BUTTONS.map(s => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                onClick={() => navigate(`/plans/${planId}/station/${s.key}`)}
                className="flex flex-col items-center gap-1.5 p-3 border border-border rounded-xl hover:border-primary/40 hover:bg-secondary/40 transition-all group"
              >
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", s.color)}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-xs text-center leading-tight text-muted-foreground group-hover:text-foreground transition-colors">
                  {s.label}
                </span>
                <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
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
          <span className="text-xs text-muted-foreground">{plan.items?.length ?? 0} recipes</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/20 border-b border-border">
              <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">#</th>
              <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">Recipe</th>
              <th className="py-2.5 px-4 text-center font-medium text-muted-foreground">Target</th>
              <th className="py-2.5 px-4 text-center font-medium text-muted-foreground">Complete</th>
              <th className="py-2.5 px-4 text-center font-medium text-muted-foreground">Wonlys</th>
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
                in_progress: { color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", label: "In Progress" },
                completed: { color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", label: "Done" },
                skipped: { color: "bg-secondary text-muted-foreground", label: "Skipped" },
              }[item.status ?? "pending"] ?? { color: "bg-secondary text-secondary-foreground", label: item.status };

              return (
                <tr key={item.id} className="border-b border-border/50 last:border-0">
                  <td className="py-3 px-4 text-muted-foreground">{item.orderPosition}</td>
                  <td className="py-3 px-4">
                    <span className="font-medium">{item.recipeName ?? `Recipe #${item.recipeId}`}</span>
                  </td>
                  <td className="py-3 px-4 text-center font-medium">{item.batchesTarget ?? 0}</td>
                  <td className="py-3 px-4 text-center">{item.batchesComplete ?? 0}</td>
                  <td className="py-3 px-4 text-center">
                    {(item.wonlyCount ?? 0) > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">{item.wonlyCount}</span>
                    ) : (
                      <span className="text-muted-foreground opacity-40">0</span>
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
        </table>
      </div>

      {plan.notes && (
        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-xl p-4 text-sm">
          <p className="font-medium text-amber-800 dark:text-amber-300 mb-1">Notes</p>
          <p className="text-amber-700 dark:text-amber-400">{plan.notes}</p>
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
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Plans List
// ──────────────────────────────────────────────────────────────────────────────
interface PlansListProps {
  onViewPlan: (planId: number) => void;
  onCreatePlan: () => void;
}

function PlansList({ onViewPlan, onCreatePlan }: PlansListProps) {
  const { data: plans, isLoading } = useListProductionPlans();
  const { deletePlan } = useAppMutations();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortNewest, setSortNewest] = useState(true);

  const filtered = useMemo(() => {
    let list = plans ?? [];
    if (statusFilter !== "all") list = list.filter(p => p.status === statusFilter);
    return [...list].sort((a, b) => {
      const diff = new Date(b.planDate).getTime() - new Date(a.planDate).getTime();
      return sortNewest ? diff : -diff;
    });
  }, [plans, statusFilter, sortNewest]);

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
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "draft", "active", "prep", "building", "complete"] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              "px-3 py-1 rounded-lg text-sm transition-colors capitalize",
              statusFilter === s
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            )}
          >
            {s === "all" ? "All Plans" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <div className="ml-auto">
          <button
            onClick={() => setSortNewest(p => !p)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 border border-border rounded-lg transition-colors"
          >
            {sortNewest ? "Newest first" : "Oldest first"}
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-secondary/20 rounded-xl border border-dashed border-border">
          <CalendarDays className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
          <p className="font-medium text-muted-foreground">No plans found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {statusFilter !== "all" ? "Try removing filters or" : ""} Create your first production plan
          </p>
          <button
            onClick={onCreatePlan}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover-lift"
          >
            <Plus className="w-4 h-4 inline mr-1" />
            Create Plan
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(plan => {
            const statusConfig = STATUS_CONFIG[plan.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
            const StatusIcon = statusConfig.icon;

            return (
              <div
                key={plan.id}
                className="bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-all cursor-pointer group"
                onClick={() => onViewPlan(plan.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                        {plan.name}
                      </h3>
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 flex-shrink-0", statusConfig.color)}>
                        <StatusIcon className="w-3 h-3" />
                        {statusConfig.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="w-3.5 h-3.5" />
                        {format(parseISO(plan.planDate), "EEEE d MMM yyyy")}
                      </span>
                      <span className="font-mono text-xs">
                        #{plan.batchNumber ?? julianBatchNumber(plan.planDate)}
                      </span>
                      {plan.notes && (
                        <span className="text-xs truncate max-w-48">{plan.notes}</span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={e => {
                      e.stopPropagation();
                      deletePlan.mutate({ id: plan.id });
                    }}
                    className="opacity-0 group-hover:opacity-100 p-2 text-muted-foreground hover:text-destructive transition-all rounded-lg hover:bg-destructive/10"
                    title="Delete plan"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────────────────
export default function ProductionPlans() {
  const [view, setView] = useState<PlanView>("list");
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

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
    handleViewPlan(planId);
  };

  return (
    <div className="space-y-6">
      {view === "list" && (
        <>
          <PageHeader
            title="Production Plans"
            description="Schedule daily production runs with DPT-calculated batch targets."
            action={
              <button
                onClick={() => setIsCreateOpen(true)}
                className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 hover-lift flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                Create Plan
              </button>
            }
          />
          <PlansList onViewPlan={handleViewPlan} onCreatePlan={() => setIsCreateOpen(true)} />
        </>
      )}

      {view === "detail" && selectedPlanId !== null && (
        <PlanDetail planId={selectedPlanId} onBack={handleBack} />
      )}

      <CreatePlanDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={handlePlanCreated}
      />
    </div>
  );
}
