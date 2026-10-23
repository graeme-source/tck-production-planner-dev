import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, CheckCircle2, Package, X as XIcon } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { StockCheckDialog, StockCheckTrigger, useRecordedStockLabel } from "./stock-check-entry";
import { useTimedReminders } from "./timed-reminders";
import { useByWarning } from "./stock-count-units";
import { londonToday } from "@/lib/station-training";
import {
  isPrepDayToday,
  londonClock,
  outstandingStockChecks,
  isStockCheckDueToday,
  stockCheckAlarmHeadline,
  stockCheckAlarmState,
  stockCheckAlarmWindow,
  stockCheckPopupDismissKey,
  stockCheckPopupView,
  type PrepTarget,
} from "./stock-check-alarm";

// ─────────────────────────────────────────────────────────────────────────
// Today's prep stock checks. Four pieces, one source:
//
//   • usePrepStockChecks — the data + alarm state (stock-check-alarm.ts).
//   • StockCheckList     — every stock-check-enabled ingredient due today,
//                          outstanding first; "Show completed" reveals the
//                          recorded ones so a reading can be overwritten.
//   • StockCheckStatusPanel — the collapsible bar on the Prepping For hub.
//   • StockCheckDuePopupHost — the 14:55 must-dismiss pop-up (#324), shown
//                          on the hub (inside the panel) and on every prep
//                          section (inside the tabs), whichever tab is open.
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
 *  panel, the Stock Check tab and the 14:55 pop-up, so they can't disagree. */
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
  return { isLoading, items, checkByIngredient, outstanding, completed, alarm, state, headline, londonDate: clock.dateStr };
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
  // Use-by dates recorded with today's counts (#165) — shown on each row,
  // red when today or past.
  const { data: useByData } = useQuery<{ useBy: Record<string, string> }>({
    queryKey: ["stock-check-use-by", checkDate],
    enabled: !!checkDate,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/stock-check-use-by?checkDate=${checkDate}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Use-by dates failed to load (${res.status})`);
      return res.json();
    },
  });

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
              {record && useByData?.useBy[String(it.id)] && (() => {
                const iso = useByData.useBy[String(it.id)]!;
                const warn = useByWarning(iso, londonToday());
                return (
                  <span
                    className={cn(
                      "text-sm font-semibold rounded-lg px-2 py-1",
                      warn ? "bg-red-100 text-red-800 border border-red-400 dark:bg-red-950/50 dark:text-red-200" : "bg-secondary text-foreground",
                    )}
                    title={warn ?? undefined}
                  >
                    Use by {new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                    {warn ? (iso < londonToday() ? " — PASSED" : " — TODAY") : ""}
                  </span>
                );
              })()}
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
      {/* The 14:55 pop-up, hidden while an entry from this panel is open. */}
      <StockCheckDuePopupHost checkDate={checkDate} checks={checks} suppressed={activeId != null} />
    </div>
  );
}

function readDismissed(key: string): boolean {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}

/** The 14:55 must-dismiss pop-up (#324) for a prep screen, fed by the same
 *  usePrepStockChecks result as that screen's bar or Stock Check tab. Picking
 *  an item opens its stock check here (the pop-up hides while it's open and
 *  comes back for anything left); "I'm aware, carry on" or X dismisses it for
 *  this person for the rest of the day. Mount one per screen. */
export function StockCheckDuePopupHost({ checkDate, checks, suppressed = false }: {
  checkDate: string;
  checks: PrepStockChecks;
  /** True while another stock-check entry on this screen is open. */
  suppressed?: boolean;
}) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const { state: authState } = useAuth();
  const userId = authState.status === "authenticated" ? authState.user.id : null;
  const dismissKey = stockCheckPopupDismissKey(userId, checks.londonDate);
  const [dismissedToday, setDismissedToday] = useState(() => readDismissed(dismissKey));
  useEffect(() => { setDismissedToday(readDismissed(dismissKey)); }, [dismissKey]);
  const dismissPopup = () => {
    setDismissedToday(true);
    try { localStorage.setItem(dismissKey, "1"); } catch { /* storage unavailable: dismissed for this session only */ }
  };

  const view = checks.isLoading ? null : stockCheckPopupView({
    outstanding: checks.outstanding,
    prepDay: checks.alarm.prepDay,
    secondsOfDay: checks.alarm.secondsOfDay,
    window: checks.alarm.window,
    dismissedToday,
  });
  const activeItem = activeId != null ? checks.items.find(it => it.id === activeId) ?? null : null;

  return (
    <>
      {view && !activeItem && !suppressed && (
        <StockCheckDuePopup
          headline={view.headline}
          items={view.items}
          onPick={setActiveId}
          onDismiss={dismissPopup}
        />
      )}
      {activeItem && (
        <StockCheckDialog
          ingredient={activeItem}
          checkDate={checkDate}
          currentNative={checks.checkByIngredient.has(activeItem.id) ? Number(checks.checkByIngredient.get(activeItem.id)!.quantity) : null}
          onClose={() => setActiveId(null)}
        />
      )}
    </>
  );
}

/** Full-screen "Stock check due in 5 minutes" pop-up (Fix queue #324). Each
 *  outstanding item is a big button that opens its stock check; "I'm aware,
 *  carry on" (or X) dismisses it for this person for the rest of the day. */
function StockCheckDuePopup({ headline, items, onPick, onDismiss }: {
  headline: string;
  items: readonly StockCheckStatusItem[];
  onPick: (id: number) => void;
  onDismiss: () => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[105] flex items-center justify-center bg-black/70 p-3 sm:p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="stock-check-due-title"
    >
      <div className="bg-card text-foreground border-4 border-red-600 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col">
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 bg-red-600 text-white rounded-t-xl">
          <AlarmClock className="w-8 h-8 flex-shrink-0 mt-0.5" />
          <h2 id="stock-check-due-title" className="flex-1 min-w-0 font-display font-bold text-2xl leading-tight">
            {headline}
          </h2>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            className="w-11 h-11 -mr-2 -mt-1 rounded-full flex items-center justify-center text-white hover:bg-white/15 flex-shrink-0"
          >
            <XIcon className="w-7 h-7" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          <p className="text-base text-muted-foreground mb-3">Tap an item to record its stock check now.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {items.map(it => (
              <button
                key={it.id}
                type="button"
                onClick={() => onPick(it.id)}
                className="min-h-16 px-4 py-3 rounded-xl border-2 border-red-500 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 text-lg font-bold text-left flex items-center gap-3 hover:bg-red-100 dark:hover:bg-red-900/40 active:scale-[0.98] transition-transform"
              >
                <Package className="w-6 h-6 flex-shrink-0" />
                <span className="flex-1 min-w-0 break-words">{it.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border">
          <button
            type="button"
            onClick={onDismiss}
            className="w-full min-h-14 rounded-xl bg-secondary text-foreground text-lg font-semibold hover:bg-secondary/80"
          >
            I&rsquo;m aware, carry on
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
