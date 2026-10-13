import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, CheckCircle2, Loader2, Package, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { nativeToPackCount, packNoun, packSizeHint, packsToNative } from "./prep-helpers";
import { useTimedReminders } from "./timed-reminders";
import {
  isPrepDayToday,
  londonClock,
  outstandingStockChecks,
  isStockCheckDueToday,
  stockCheckAlarmHeadline,
  stockCheckAlarmState,
  stockCheckAlarmWindow,
  type PrepTarget,
} from "./stock-check-alarm";

// ─────────────────────────────────────────────────────────────────────────
// StockCheckStatusPanel — "Stock check records for today", at the top of
// every prep screen (Prep hub, Main Prep, Bases & Sauces, Raw Meat). Lists
// every stock-check-enabled ingredient due today and highlights which
// haven't been recorded yet. Outstanding items are shown by default so the
// operator's eye goes straight to what still needs doing; "Show completed"
// reveals the recorded ones so a reading can be overwritten.
//
// On a prep day it is also the 3pm alarm (Graeme, 13 Oct 2026): from the
// warning time it flashes red with the minutes left and the outstanding
// items by name (tap one to record it); after the deadline it is solid red
// "Overdue". Rules and wording: stock-check-alarm.ts.
//
// Polls every 10s so writes from any device / station show near real time.
// ─────────────────────────────────────────────────────────────────────────

interface StockCheckStatusItem {
  id: number;
  name: string;
  unit: string;
  stockCheckFrequency: string;
  stockCheckDay: string | null;
  stockInPacks?: boolean;
  packWeight?: number | null;
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

interface StockChecksResponse {
  checks: StockCheckRecord[];
  stockIngredients: StockCheckStatusItem[];
}

export const stockChecksQueryKey = (checkDate: string) => ["prep-stock-checks", checkDate] as const;

/** London clock, re-read every few seconds (minutes-left precision). */
function useLondonClock(intervalMs = 5_000) {
  const [clock, setClock] = useState(() => londonClock());
  useEffect(() => {
    const id = setInterval(() => setClock(londonClock()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return clock;
}

export function StockCheckStatusPanel({ checkDate, prepTarget }: {
  /** The day the readings are recorded against (the plan being prepped for). */
  checkDate: string;
  /** The plan being prepped for — the alarm only fires when its prep is today. */
  prepTarget: PrepTarget | null;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [inputValues, setInputValues] = useState<Record<number, string>>({});
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [editingIds, setEditingIds] = useState<Set<number>>(new Set());
  const [focusId, setFocusId] = useState<number | null>(null);
  const inputRefs = useRef(new Map<number, HTMLInputElement>());
  const reducedMotion = usePrefersReducedMotion();
  const clock = useLondonClock();
  const reminders = useTimedReminders();

  const { data, isLoading } = useQuery({
    queryKey: stockChecksQueryKey(checkDate),
    enabled: !!checkDate,
    refetchInterval: 10_000,
    queryFn: async (): Promise<StockChecksResponse> => {
      const res = await fetch(`/api/production-plans/stock-checks?date=${checkDate}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Stock checks failed to load (${res.status})`);
      const d = await res.json();
      return { checks: d.checks ?? [], stockIngredients: d.stockIngredients ?? [] };
    },
  });
  const items = data?.stockIngredients ?? [];
  const checks = data?.checks ?? [];

  // Tapping an outstanding item opens the list and puts the cursor in its box.
  useEffect(() => {
    if (!open || focusId == null) return;
    const el = inputRefs.current.get(focusId);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    }
    setFocusId(null);
  }, [open, focusId, reducedMotion]);

  const dueItems = items.filter(it => isStockCheckDueToday(it, clock.dayName));
  const checkByIngredient = new Map<number, StockCheckRecord>();
  for (const c of checks) {
    const existing = checkByIngredient.get(c.ingredientId);
    if (!existing || new Date(c.checkedAt).getTime() > new Date(existing.checkedAt).getTime()) {
      checkByIngredient.set(c.ingredientId, c);
    }
  }
  const outstanding = outstandingStockChecks(items, new Set(checkByIngredient.keys()), clock.dayName);
  const completed = dueItems.filter(it => checkByIngredient.has(it.id));

  const alarm = {
    dueCount: dueItems.length,
    outstandingCount: outstanding.length,
    prepDay: isPrepDayToday(prepTarget, clock.dateStr),
    secondsOfDay: clock.secondsOfDay,
    window: stockCheckAlarmWindow(reminders),
  };
  const state = stockCheckAlarmState(alarm);
  const headline = stockCheckAlarmHeadline({ ...alarm, state });
  const red = state === "warning" || state === "overdue";

  const visibleItems = showCompleted ? [...outstanding, ...completed] : outstanding;

  // "inputValues" holds the typed string in the DISPLAY unit (packs when
  // stockInPacks is on, native otherwise). Convert to native here so the DB
  // stays in native units — keeps cost/recipe maths untouched.
  const saveOne = async (ingredientId: number) => {
    const v = inputValues[ingredientId];
    if (v === undefined || v === "") return;
    const item = items.find(it => it.id === ingredientId);
    const inPacks = !!item?.stockInPacks && (item.packWeight ?? 0) > 0;
    const typedNumber = Number(v);
    if (!Number.isFinite(typedNumber)) return;
    const nativeQty = inPacks ? packsToNative(typedNumber, item?.packWeight) : typedNumber;
    setSavingIds(s => new Set(s).add(ingredientId));
    try {
      const res = await fetch("/api/production-plans/stock-checks", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId, checkDate, quantity: nativeQty }),
      });
      if (!res.ok) throw new Error(`Not saved (${res.status}) — please try again`);
      setInputValues(prev => { const copy = { ...prev }; delete copy[ingredientId]; return copy; });
      setEditingIds(prev => { const n = new Set(prev); n.delete(ingredientId); return n; });
      await queryClient.invalidateQueries({ queryKey: stockChecksQueryKey(checkDate) });
      queryClient.invalidateQueries({ queryKey: ["reminder-stock-checks"] });
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSavingIds(s => { const n = new Set(s); n.delete(ingredientId); return n; });
    }
  };

  if (isLoading || state === "none") return null;

  const tone = {
    done: { box: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-800", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
    pending: { box: "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-800", text: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
    // Red states: white on red, readable in light and dark. The warning
    // flashes (stock-alarm-flash in index.css) unless reduced motion is on.
    warning: { box: cn("bg-red-600 border-red-700 text-white", !reducedMotion && "stock-alarm-flash"), text: "text-white", dot: "bg-white" },
    overdue: { box: "bg-red-700 border-red-800 text-white", text: "text-white", dot: "bg-white" },
  }[state];

  return (
    <div
      className={cn("rounded-xl overflow-hidden", red ? "border-2" : "border", tone.box)}
      role={red ? "alert" : undefined}
      aria-live={red ? "assertive" : undefined}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className={cn("w-full flex items-center gap-2 px-4 text-left", red ? "py-3.5" : "py-3")}
      >
        {red
          ? <AlarmClock className="w-6 h-6 flex-shrink-0 text-white" />
          : <>
              <span className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", tone.dot)} />
              <Package className={cn("w-4 h-4 flex-shrink-0", tone.text)} />
            </>}
        <span className={cn("flex-1 min-w-0", red ? "text-base font-bold" : "text-sm font-semibold", tone.text)}>
          {headline}
        </span>
        <span className={cn("text-xs flex-shrink-0", red ? "text-white/85 font-medium" : "text-muted-foreground")}>
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {/* Red: the outstanding items by name, each one tap to record. */}
      {red && (
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {outstanding.map(it => (
            <button
              key={it.id}
              onClick={() => { setOpen(true); setFocusId(it.id); }}
              className="px-3 py-2 rounded-lg bg-white text-red-700 text-sm font-semibold shadow-sm hover:bg-red-50 active:scale-[0.98] transition-transform"
            >
              {it.name}
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="border-t border-border/60 bg-card text-foreground">
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
              const inPacks = !!it.stockInPacks && (it.packWeight ?? 0) > 0;
              const inputCount = Number(inputVal) || 0;
              const primaryUnit = inPacks ? packNoun(it.unit, inputCount) : it.unit;
              const sizeHint = inPacks ? packSizeHint(it.packWeight, it.unit) : null;
              if (record && !isEditing) {
                const checkedAt = new Date(record.checkedAt);
                const timeLabel = checkedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
                const recordNative = Number(record.quantity);
                const recordPacks = inPacks ? nativeToPackCount(recordNative, it.packWeight) : null;
                const primary = inPacks && recordPacks != null
                  ? `${recordPacks} × ${packNoun(it.unit, recordPacks)}`
                  : `${recordNative} ${it.unit}`;
                return (
                  <div key={it.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    <span className="font-medium flex-1 min-w-0 truncate">{it.name}</span>
                    <div className="flex flex-col items-end leading-tight">
                      <span className="text-sm tabular-nums text-foreground font-semibold">{primary}</span>
                      {sizeHint && (
                        <span className="text-[11px] tabular-nums text-muted-foreground/70">({sizeHint})</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground ml-2">{timeLabel}</span>
                    <button
                      onClick={() => {
                        setEditingIds(prev => { const n = new Set(prev); n.add(it.id); return n; });
                        // Prefill in the display unit so the user sees the
                        // value they'll overwrite — saveOne converts back.
                        const prefill = inPacks && recordPacks != null ? String(recordPacks) : String(recordNative);
                        setInputValues(prev => ({ ...prev, [it.id]: prefill }));
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
                    : <span className={cn("w-4 h-4 rounded-full border-2 flex-shrink-0", red ? "border-red-500" : "border-amber-500")} />}
                  <span className="font-medium flex-1 min-w-0 truncate">{it.name}</span>
                  <input
                    ref={el => { if (el) inputRefs.current.set(it.id, el); else inputRefs.current.delete(it.id); }}
                    type="number"
                    // step "any" + decimal keyboard even in pack mode — the
                    // team records part-packs (e.g. 0.5 of a box).
                    step="any"
                    min="0"
                    inputMode="decimal"
                    value={inputVal}
                    onChange={e => setInputValues(prev => ({ ...prev, [it.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter" && inputVal !== "") saveOne(it.id); }}
                    placeholder={inPacks ? "0" : "qty"}
                    autoFocus={isEditing}
                    className="w-20 px-2 py-1 text-sm text-right bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                  />
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs font-semibold">{primaryUnit}</span>
                    {sizeHint && (
                      <span className="text-[11px] tabular-nums text-muted-foreground/70">({sizeHint})</span>
                    )}
                  </div>
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
