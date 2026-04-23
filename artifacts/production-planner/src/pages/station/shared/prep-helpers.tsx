import React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { CalendarCheck, AlertTriangle, Package, CheckCircle2, Loader2, Pencil } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { PrepRequirementItem } from "@workspace/api-client-react";

export function fmtQty(q: number, unit: string): string {
  if (unit === "g" && q >= 1000) return `${(q / 1000).toFixed(3)} kg`;
  if (unit === "ml" && q >= 1000) return `${(q / 1000).toFixed(3)} l`;
  if (unit === "kg") return `${q.toFixed(3)} kg`;
  if (unit === "l" || unit === "L") return `${q.toFixed(3)} l`;
  if (unit === "pieces") {
    const n = Math.round(q);
    return `${n} ${n === 1 ? "piece" : "pieces"}`;
  }
  return `${q % 1 === 0 ? q : q.toFixed(2)} ${unit}`;
}

export const toKg = (qty: number, unit: string): number =>
  unit === "g" ? qty / 1000 : unit === "mg" ? qty / 1_000_000 : qty;

export function PrepIngredientTable({ items }: { items: PrepRequirementItem[] }) {
  if (items.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <p className="font-medium">No ingredients to display</p>
        <p className="text-sm mt-1">Make sure ingredient categories are set in the ingredients library</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-secondary/20 border-b border-border">
            <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">Ingredient</th>
            <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">Recipes</th>
            <th className="py-2.5 px-4 text-right font-medium text-muted-foreground">
              <span>Prep Qty</span>
              <span className="block text-[10px] font-normal opacity-60">weigh this</span>
            </th>
            <th className="py-2.5 px-4 text-right font-medium text-muted-foreground">Reference</th>
            <th className="py-2.5 px-4 text-right font-medium text-muted-foreground">Trays</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const hasProcLoss = item.processingRatio != null && item.processingRatio < 1;
            const mode = (item as { prepWeightMode?: string }).prepWeightMode ?? "raw";
            const prepQty = (item as { prepQty?: number }).prepQty ?? item.totalRawQty;
            const refQty = mode === "processed" ? item.totalRawQty : item.totalCookedQty;
            const refLabel = mode === "processed" ? "raw" : "cooked";
            return (
              <tr key={item.ingredientId} className="border-b border-border/50 last:border-0">
                <td className="py-3 px-4 font-medium">
                  {item.ingredientName}
                  {hasProcLoss && (
                    <span className={cn("ml-1.5 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                      mode === "processed"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    )}>
                      {mode === "processed" ? "processed wt" : "raw wt"}
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-muted-foreground text-xs">{item.recipes.join(", ")}</td>
                <td className="py-3 px-4 text-right tabular-nums font-bold text-base">
                  {fmtQty(prepQty, item.unit)}
                </td>
                <td className="py-3 px-4 text-right tabular-nums text-muted-foreground text-xs">
                  {hasProcLoss ? (
                    <>
                      {fmtQty(refQty, item.unit)} {refLabel}
                      <span className="ml-1">({((item.processingRatio ?? 1) * 100).toFixed(0)}%)</span>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </td>
                <td className="py-3 px-4 text-right">
                  {item.trayCount != null ? (
                    <span className="font-bold text-base text-rose-600 dark:text-rose-400">{item.trayCount}</span>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface NextActivePlan {
  planId: number | null;
  planDate: string | null;
  planName: string | null;
  prepDate: string | null;
  status: string | null;
  sameDayPlans?: Array<{ planId: number; planName: string }>;
}

export function useNextActivePlan(afterDate?: string) {
  const [data, setData] = useState<NextActivePlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const initialLoadDone = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!initialLoadDone.current) setIsLoading(true);
    const qs = afterDate ? `?afterDate=${afterDate}` : "";
    fetch(`/api/production-plans/next-active${qs}`, { credentials: "include", signal: ctrl.signal })
      .then(r => r.json())
      .then((json: NextActivePlan) => { setData(json); initialLoadDone.current = true; setIsLoading(false); })
      .catch((e) => { if (e.name !== "AbortError") { initialLoadDone.current = true; setIsLoading(false); } });
  }, [afterDate]);

  useEffect(() => {
    initialLoadDone.current = false;
    doFetch();
    const interval = setInterval(doFetch, 5000);
    return () => { clearInterval(interval); abortRef.current?.abort(); };
  }, [doFetch]);

  return { data, isLoading };
}

export function PrepDateBanner({
  currentPlanDate,
  targetPlanDate,
  targetPlanName,
  isLoading,
  activityLabel = "Prep",
}: {
  currentPlanDate?: string | null;
  targetPlanDate: string | null;
  targetPlanName: string | null;
  isLoading: boolean;
  activityLabel?: string;
}) {
  if (isLoading) return null;
  if (!targetPlanDate) return null;

  const targetFormatted = format(parseISO(targetPlanDate), "EEEE d MMMM");
  const currentFormatted = currentPlanDate
    ? format(parseISO(currentPlanDate), "EEEE d MMMM")
    : null;

  return (
    <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3 flex items-center gap-3">
      <CalendarCheck className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0" />
      <div className="min-w-0">
        {currentFormatted ? (
          <>
            <p className="font-bold text-green-900 dark:text-green-100 text-lg leading-snug">
              {activityLabel} on {currentFormatted}
            </p>
            <p className="text-sm text-green-700 dark:text-green-300 leading-snug">
              for production on <span className="font-semibold">{targetFormatted}</span>
            </p>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">{activityLabel} for</p>
            <p className="font-bold text-green-900 dark:text-green-100 text-lg leading-tight">{targetFormatted}</p>
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PrepDraftBanner — shown above prep stations when the next upcoming plan is
// still in draft status. The prep crew can see all prep data but completions
// are blocked (both in the UI and at the API) until the plan is activated.
// ──────────────────────────────────────────────────────────────────────────────
export function PrepDraftBanner({
  planId,
  planDate,
  planName,
  onActivated,
}: {
  planId: number;
  planDate: string;
  planName?: string | null;
  onActivated?: () => void;
}) {
  const [activating, setActivating] = useState(false);
  const dateLabel = format(parseISO(planDate), "EEE d MMM");

  const activate = async () => {
    setActivating(true);
    try {
      const res = await fetch(`/api/production-plans/${planId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
      toast({ title: "Plan activated", description: `${planName ?? "Plan"} is now active — you can start prepping.` });
      onActivated?.();
    } catch (e) {
      toast({
        title: "Failed to activate plan",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-center gap-3">
      <AlertTriangle className="w-7 h-7 text-amber-600 dark:text-amber-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-amber-900 dark:text-amber-200 text-base leading-tight">
          Draft plan — activate before starting prep
        </h3>
        <p className="text-sm text-amber-800 dark:text-amber-300 leading-snug mt-0.5">
          {planName ?? "This plan"} ({dateLabel}) is still a draft. You can see what's needed below,
          but completions are locked until it's activated. Batch numbers may still change while draft.
        </p>
      </div>
      <button
        onClick={activate}
        disabled={activating}
        className="px-4 py-2 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-50 flex-shrink-0 whitespace-nowrap"
      >
        {activating ? "Activating…" : "Activate now"}
      </button>
    </div>
  );
}

/** Shared toast helper for stations blocking actions when the plan is draft. */
export function toastDraftBlocked() {
  toast({
    title: "Plan is a draft",
    description: "Activate the plan before recording completions.",
    variant: "destructive",
  });
}

// ─────────────────────────────────────────────────────────────────────────
// StockCheckStatusPanel — shared across all three prep sub-stations
// (main prep, bases, raw meat). Lists every stock-check-enabled ingredient
// that's due today and highlights which haven't been recorded yet.
// Outstanding items are shown by default so the operator's eye goes
// straight to what still needs doing. "Show completed" reveals the ones
// already recorded so they can be overwritten if a reading needs fixing.
// Polls every 10s so writes from any device / station update in near
// real time.
// ─────────────────────────────────────────────────────────────────────────
interface StockCheckStatusItem {
  id: number;
  name: string;
  unit: string;
  stockCheckFrequency: string;
  stockCheckDay: string | null;
}

interface StockCheckRecord {
  id: number;
  ingredientId: number;
  ingredientName: string;
  unit: string;
  quantity: string;
  checkedAt: string;
  userId: number | null;
}

export function StockCheckStatusPanel({ checkDate }: { checkDate: string }) {
  const [open, setOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [items, setItems] = useState<StockCheckStatusItem[]>([]);
  const [checks, setChecks] = useState<StockCheckRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputValues, setInputValues] = useState<Record<number, string>>({});
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [editingIds, setEditingIds] = useState<Set<number>>(new Set());

  const todayDayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()];
  const isDueToday = (it: StockCheckStatusItem) =>
    it.stockCheckFrequency !== "weekly" || it.stockCheckDay === todayDayName;

  const refresh = useCallback(() => {
    if (!checkDate) return;
    fetch(`/api/production-plans/stock-checks?date=${checkDate}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((d: { checks: StockCheckRecord[]; stockIngredients: StockCheckStatusItem[] } | null) => {
        if (!d) return;
        setItems(d.stockIngredients ?? []);
        setChecks(d.checks ?? []);
      })
      .finally(() => setLoading(false));
  }, [checkDate]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const dueItems = items.filter(isDueToday);
  const checkByIngredient = new Map<number, StockCheckRecord>();
  for (const c of checks) {
    const existing = checkByIngredient.get(c.ingredientId);
    if (!existing || new Date(c.checkedAt).getTime() > new Date(existing.checkedAt).getTime()) {
      checkByIngredient.set(c.ingredientId, c);
    }
  }
  const outstanding = dueItems.filter(it => !checkByIngredient.has(it.id));
  const completed = dueItems.filter(it => checkByIngredient.has(it.id));
  const allDone = dueItems.length > 0 && outstanding.length === 0;

  const visibleItems = showCompleted
    ? [...outstanding, ...completed]
    : outstanding;

  const saveOne = async (ingredientId: number) => {
    const v = inputValues[ingredientId];
    if (v === undefined || v === "") return;
    setSavingIds(s => new Set(s).add(ingredientId));
    try {
      await fetch("/api/production-plans/stock-checks", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId, checkDate, quantity: Number(v) }),
      });
      setInputValues(prev => { const copy = { ...prev }; delete copy[ingredientId]; return copy; });
      setEditingIds(prev => { const n = new Set(prev); n.delete(ingredientId); return n; });
      refresh();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSavingIds(s => { const n = new Set(s); n.delete(ingredientId); return n; });
    }
  };

  if (loading || dueItems.length === 0) return null;

  const summary = allDone
    ? { text: `All ${dueItems.length} stock checks recorded for today`, tone: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-800" }
    : { text: `${outstanding.length} of ${dueItems.length} stock check${dueItems.length === 1 ? "" : "s"} outstanding for today`, tone: "text-amber-700 dark:text-amber-300", bg: "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-800" };

  return (
    <div className={cn("border rounded-xl", summary.bg)}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <span className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", allDone ? "bg-emerald-500" : "bg-amber-500")} />
        <Package className={cn("w-4 h-4 flex-shrink-0", summary.tone)} />
        <span className={cn("text-sm font-semibold flex-1", summary.tone)}>{summary.text}</span>
        <span className="text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="border-t border-border/60">
          {completed.length > 0 && (
            <div className="px-4 py-2 flex items-center justify-between text-xs border-b border-border/60">
              <span className="text-muted-foreground">
                {outstanding.length === 0
                  ? "Everything for today is in."
                  : `${completed.length} already recorded`}
              </span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={e => setShowCompleted(e.target.checked)}
                  className="rounded border-border"
                />
                <span>Show completed</span>
              </label>
            </div>
          )}
          <div className="divide-y divide-border/60">
            {visibleItems.length === 0 && (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                Nothing outstanding — tick &ldquo;Show completed&rdquo; to review today&rsquo;s records.
              </div>
            )}
            {visibleItems.map(it => {
              const record = checkByIngredient.get(it.id);
              const saving = savingIds.has(it.id);
              const inputVal = inputValues[it.id] ?? "";
              const isEditing = editingIds.has(it.id);
              if (record && !isEditing) {
                const checkedAt = new Date(record.checkedAt);
                const timeLabel = checkedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                return (
                  <div key={it.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    <span className="font-medium flex-1 min-w-0 truncate">{it.name}</span>
                    <span className="text-sm tabular-nums text-foreground font-semibold">
                      {Number(record.quantity)} {it.unit}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">{timeLabel}</span>
                    <button
                      onClick={() => {
                        setEditingIds(prev => { const n = new Set(prev); n.add(it.id); return n; });
                        setInputValues(prev => ({ ...prev, [it.id]: String(Number(record.quantity)) }));
                      }}
                      title="Overwrite this record"
                      className="text-muted-foreground hover:text-foreground p-1 -m-1"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              }
              return (
                <div key={it.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  {record
                    ? <Pencil className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    : <span className="w-4 h-4 rounded-full border-2 border-amber-500 flex-shrink-0" />}
                  <span className="font-medium flex-1 min-w-0 truncate">{it.name}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={inputVal}
                    onChange={e => setInputValues(prev => ({ ...prev, [it.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter" && inputVal !== "") saveOne(it.id); }}
                    placeholder="qty"
                    autoFocus={isEditing}
                    className="w-20 px-2 py-1 text-sm text-right bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                  />
                  <span className="text-xs text-muted-foreground min-w-[1.5rem]">{it.unit}</span>
                  <button
                    onClick={() => saveOne(it.id)}
                    disabled={saving || inputVal === ""}
                    className={cn(
                      "text-xs px-3 py-1 rounded-md text-white transition-colors disabled:opacity-40",
                      record ? "bg-blue-600 hover:bg-blue-700" : "bg-amber-600 hover:bg-amber-700",
                    )}
                  >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : record ? "Overwrite" : "Save"}
                  </button>
                  {record && (
                    <button
                      onClick={() => {
                        setEditingIds(prev => { const n = new Set(prev); n.delete(it.id); return n; });
                        setInputValues(prev => { const c = { ...prev }; delete c[it.id]; return c; });
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
