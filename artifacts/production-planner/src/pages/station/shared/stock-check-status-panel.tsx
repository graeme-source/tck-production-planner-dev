import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, CheckCircle2, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { StockCheckDialog, recordedStockLabel } from "./stock-check-entry";
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
// Each row's "Stock check" button (and each red chip) opens the shared
// two-step entry — amount, then a unit the person taps (stock-check-entry.tsx,
// Graeme 15 Oct 2026). Polls every 10s so writes from any device / station
// show near real time.
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
  const [open, setOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  // The item whose stock-check dialog is open (row button or red chip).
  const [activeId, setActiveId] = useState<number | null>(null);
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

  const activeItem = activeId != null ? items.find(it => it.id === activeId) ?? null : null;

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
              onClick={() => { setOpen(true); setActiveId(it.id); }}
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
            <div className="px-4 py-2 flex items-center justify-between text-sm border-b border-border/60">
              <span className="text-muted-foreground">
                {outstanding.length === 0
                  ? "Everything for today is in."
                  : `${completed.length} already recorded`}
              </span>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none min-h-11">
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={e => setShowCompleted(e.target.checked)}
                  className="w-5 h-5 rounded border-border"
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
              const recordNative = record ? Number(record.quantity) : null;
              const timeLabel = record
                ? new Date(record.checkedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
                : null;
              return (
                <div key={it.id} className="px-4 py-2.5 flex items-center gap-3 text-sm flex-wrap">
                  {record
                    ? <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                    : <span className={cn("w-5 h-5 rounded-full border-2 flex-shrink-0", red ? "border-red-500" : "border-amber-500")} />}
                  <span className="font-semibold text-base flex-1 min-w-[8rem] truncate">{it.name}</span>
                  {timeLabel && <span className="text-xs text-muted-foreground">{timeLabel}</span>}
                  <button
                    type="button"
                    onClick={() => setActiveId(it.id)}
                    className={cn(
                      "min-h-[48px] px-4 rounded-xl text-base font-bold inline-flex items-center gap-2 transition-colors active:scale-[0.98]",
                      record
                        ? "bg-emerald-50 text-emerald-800 border-2 border-emerald-300 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800"
                        : "bg-blue-600 text-white hover:bg-blue-700 shadow",
                    )}
                  >
                    <Package className="w-5 h-5 flex-shrink-0" />
                    {record && recordNative != null
                      ? <span className="text-left leading-tight">{recordedStockLabel(recordNative, it)}<span className="block text-xs font-medium opacity-80">Tap to recount</span></span>
                      : "Stock check"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {activeItem && (
        <StockCheckDialog
          ingredient={activeItem}
          checkDate={checkDate}
          currentNative={checkByIngredient.has(activeItem.id) ? Number(checkByIngredient.get(activeItem.id)!.quantity) : null}
          onClose={() => setActiveId(null)}
        />
      )}
    </div>
  );
}
