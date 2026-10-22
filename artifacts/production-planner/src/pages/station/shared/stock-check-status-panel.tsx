import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, CheckCircle2, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { StockCheckDialog, StockCheckTrigger, useRecordedStockLabel } from "./stock-check-entry";
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
// Today's prep stock checks. Three pieces, one source:
//
//   • usePrepStockChecks — the data + alarm state (stock-check-alarm.ts).
//   • StockCheckList     — every stock-check-enabled ingredient due today,
//                          outstanding first; "Show completed" reveals the
//                          recorded ones so a reading can be overwritten.
//   • StockCheckStatusPanel — the collapsible bar on the Prepping For hub.
//
// On the prep sections (Main Prep, Bases & Sauces, Raw Meat) the bar became
// the fourth tab, Stock Check (prep-section-tabs.tsx, Graeme 22 Oct 2026):
// the tab carries the colour + count and its body is StockCheckList.
//
// On a prep day it is also the 3pm alarm (Graeme, 13 Oct 2026): from the
// warning time it flashes red with the minutes left and the outstanding
// items by name (tap one to record it); after the deadline it is solid red
// "Overdue". Rules and wording: stock-check-alarm.ts.
//
// Each row's "Record stock check for this item" button (and each red chip)
// opens the shared two-step entry — the unit it's counted in, then one
// number (stock-check-entry.tsx, Graeme 19 Oct 2026). Polls every 10s so writes from any device / station
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

/** Today's stock checks for the prep screens — the one source for the hub
 *  panel and the Stock Check tab, so they can't disagree. */
export function usePrepStockChecks(checkDate: string, prepTarget: PrepTarget | null) {
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
  return { isLoading, items, checkByIngredient, outstanding, completed, alarm, state, headline };
}

export type PrepStockChecks = ReturnType<typeof usePrepStockChecks>;

/** The list of today's stock checks, each row opening the shared entry
 *  dialog. The body of the hub panel (when shown) and of the Stock Check tab. */
export function StockCheckList({ checkDate, checks, activeId, setActiveId }: {
  checkDate: string;
  checks: PrepStockChecks;
  /** The item whose entry dialog is open — lifted so the hub panel's red
   *  chips can open one too. */
  activeId: number | null;
  setActiveId: (id: number | null) => void;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const recordedStockLabel = useRecordedStockLabel();
  const { items, checkByIngredient, outstanding, completed, state } = checks;
  const red = state === "warning" || state === "overdue";
  const visibleItems = showCompleted ? [...outstanding, ...completed] : outstanding;
  const activeItem = activeId != null ? items.find(it => it.id === activeId) ?? null : null;

  return (
    <>
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
            {completed.length === 0
              ? "No stock checks are due today."
              : <>Nothing outstanding — tick &ldquo;Show completed&rdquo; to review today&rsquo;s records.</>}
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
              <span className="font-semibold text-base flex-1 min-w-[8rem]">{it.name}</span>
              {timeLabel && <span className="text-xs text-muted-foreground">{timeLabel}</span>}
              <StockCheckTrigger
                recordedLabel={record && recordNative != null ? recordedStockLabel(recordNative, it) : null}
                onClick={() => setActiveId(it.id)}
              />
            </div>
          );
        })}
      </div>
      {activeItem && (
        <StockCheckDialog
          ingredient={activeItem}
          checkDate={checkDate}
          currentNative={checkByIngredient.has(activeItem.id) ? Number(checkByIngredient.get(activeItem.id)!.quantity) : null}
          onClose={() => setActiveId(null)}
        />
      )}
    </>
  );
}

export function StockCheckStatusPanel({ checkDate, prepTarget }: {
  /** The day the readings are recorded against (the plan being prepped for). */
  checkDate: string;
  /** The plan being prepped for — the alarm only fires when its prep is today. */
  prepTarget: PrepTarget | null;
}) {
  const [open, setOpen] = useState(false);
  // The item whose stock-check dialog is open (row button or red chip).
  const [activeId, setActiveId] = useState<number | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const checks = usePrepStockChecks(checkDate, prepTarget);
  const { isLoading, outstanding, state, headline } = checks;
  const red = state === "warning" || state === "overdue";

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
          <StockCheckList checkDate={checkDate} checks={checks} activeId={activeId} setActiveId={setActiveId} />
        </div>
      )}
    </div>
  );
}
