import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import type { StationType } from "./constants";
import {
  resolveReminderDisplay,
  factoryCountConditionApplies,
  countAlarmPhase,
  reminderShownByPrepPanel,
  type FactoryCountState,
} from "./reminder-conditions";

// ─────────────────────────────────────────────────────────────────────────────
// Timed station reminders
//
// Configurable banners that appear on station screens at a set London wall-
// clock time each day, with a live countdown to a deadline — e.g. "stock
// checks due by 3pm" on Prep from 14:45. The list lives as JSON in the
// app_settings key below and is managed from Settings → Production → Timed
// reminders (admin). Defaults are seeded server-side on first boot.
// ─────────────────────────────────────────────────────────────────────────────

export const TIMED_REMINDERS_KEY = "timed_station_reminders";

export interface TimedReminder {
  id: string;
  title: string;
  message: string;
  /** Station route keys this reminder appears on (e.g. "prep", "wrapping"). */
  stations: string[];
  /** London wall clock, "HH:MM". Banner appears from here… */
  startTime: string;
  /** …and counts down to here, then disappears. */
  endTime: string;
  enabled: boolean;
  /** Prep-only condition: hide unless today still has unrecorded stock
   *  checks. Ignored on any non-prep station (reminder-conditions.ts). On
   *  prep screens it isn't shown as a banner: its start/end times drive the
   *  "Stock check records for today" panel's red alarm instead
   *  (stock-check-alarm.ts). */
  onlyIfStockChecksOutstanding?: boolean;
  /** Packing/Wrapping-only condition: hide once today's Factory Number count
   *  (Stock Control → Production fridge) is complete. Ignored elsewhere. */
  onlyIfFactoryCountOutstanding?: boolean;
}

export function parseReminders(raw: string | null | undefined): TimedReminder[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((r: any) =>
      r && typeof r.id === "string" && typeof r.message === "string" &&
      Array.isArray(r.stations) && /^\d{2}:\d{2}$/.test(r.startTime ?? "") &&
      /^\d{2}:\d{2}$/.test(r.endTime ?? ""),
    );
  } catch {
    return [];
  }
}

// The kitchen runs on London wall-clock time; iPads may drift or sit in
// another locale, so compute the trigger window from Europe/London, matching
// the server's london-time helpers.
function londonNowParts(): { h: number; m: number; s: number; dateStr: string; dayName: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "long", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return {
    h: Number(get("hour")) % 24,
    m: Number(get("minute")),
    s: Number(get("second")),
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    dayName: get("weekday"),
  };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Today's Factory Number count — complete, and how many products are still
 *  to count (GET /api/stock-control/factory-count-today). Only polled while
 *  `enabled`. */
function useFactoryCountToday(enabled: boolean, dateStr: string): FactoryCountState | null {
  const { data } = useQuery({
    queryKey: ["reminder-factory-count", dateStr],
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/stock-control/factory-count-today?date=${dateStr}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{ complete: boolean; outstanding: number }>;
    },
  });
  if (!enabled || !data) return null;
  return { complete: !!data.complete, outstanding: typeof data.outstanding === "number" ? data.outstanding : null };
}

/** The configured timed reminders (app_settings), shared by the banner and
 *  the prep stock-check panel (which takes its alarm times from them). */
export function useTimedReminders(): TimedReminder[] {
  const { data: remindersRaw } = useQuery({
    queryKey: ["app-setting", TIMED_REMINDERS_KEY],
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/app-settings/${TIMED_REMINDERS_KEY}`, { credentials: "include" });
      if (!res.ok) return null;
      const j = await res.json();
      return (j?.value as string) ?? null;
    },
  });
  return parseReminders(remindersRaw);
}

export function StationReminderBanner({ stationType, plan, live }: {
  stationType: StationType;
  plan: ProductionPlanDetail | undefined;
  /** Screens with no plan of their own (Order Packing Live) say the day is
   *  live themselves; station screens leave it to the plan. */
  live?: boolean;
}) {
  const reminders = useTimedReminders();

  // 1s tick drives the countdown display and the window check.
  const [nowParts, setNowParts] = useState(londonNowParts);
  useEffect(() => {
    const id = setInterval(() => setNowParts(londonNowParts()), 1000);
    return () => clearInterval(id);
  }, []);

  const nowSeconds = nowParts.h * 3600 + nowParts.m * 60 + nowParts.s;

  // Reminders only fire inside a live production day — never on completed plans.
  const planLive = live ?? (!!plan && plan.status !== "complete");

  // Inside the window — or, for the Factory Number count on packing /
  // wrapping, any time after it too: that one stays up as "Overdue" until
  // the count is done (countAlarmPhase).
  const inWindow = (r: TimedReminder) =>
    r.enabled &&
    r.stations.includes(stationType) &&
    countAlarmPhase(r, stationType, nowSeconds) !== "none";
  const reducedMotion = usePrefersReducedMotion();

  // On prep screens the stock-check reminder is shown by the "Stock check
  // records for today" panel itself (flashing red from its start time), so
  // the banner would only repeat it — one clear warning, not two.
  const candidates = planLive
    ? reminders.filter(r => inWindow(r) && !reminderShownByPrepPanel(r, stationType))
    : [];

  // Only hit each endpoint while a reminder that needs it is in its window
  // on a station where its condition applies.
  // (No stock-check count is needed here: the only reminders that use it
  // are the prep ones, and the prep panel shows those — see above.)
  const stockChecksOutstanding = null;
  const needsFactoryCount = candidates.some(r => factoryCountConditionApplies(r, stationType));
  const factoryCount = useFactoryCountToday(needsFactoryCount, nowParts.dateStr);

  const active = candidates
    .map(r => ({ r, display: resolveReminderDisplay(r, stationType, { stockChecksOutstanding, factoryCount }) }))
    .filter(x => x.display.show);

  if (active.length === 0) return null;

  // The Factory Number count can't be missed (Graeme, 2026-10-15: the
  // wrapping team didn't see it because the screen was scrolled): pinned to
  // the top of the screen, outside the scrolling page, flashing red in its
  // window and solid red "Overdue" after, until the count is complete.
  const pinned = active.filter(x => factoryCountConditionApplies(x.r, stationType));
  const inline = active.filter(x => !factoryCountConditionApplies(x.r, stationType));

  return (
    <>
    {pinned.length > 0 && (
      <div className="fixed inset-x-0 top-0 z-[70] pt-[env(safe-area-inset-top)] space-y-0.5" role="alert" aria-live="assertive">
        {pinned.map(({ r, display }) => {
          const overdue = countAlarmPhase(r, stationType, nowSeconds) === "overdue";
          const remaining = Math.max(0, toMinutes(r.endTime) * 60 - nowSeconds);
          const mm = Math.floor(remaining / 60);
          const ss = remaining % 60;
          return (
            <div key={r.id} className={cn(
              "text-white px-4 py-3 flex items-center gap-3 shadow-xl",
              overdue ? "bg-red-700" : cn("bg-red-600", !reducedMotion && "stock-alarm-flash"),
            )}>
              <AlarmClock className="w-8 h-8 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-lg leading-snug">
                  {overdue ? "OVERDUE — " : ""}{r.title}
                  {display.suffix && <span className="font-semibold"> — {display.suffix}</span>}
                </p>
                <p className="text-sm text-white/90 leading-snug">{r.message}</p>
              </div>
              <span className="text-3xl font-display font-bold tabular-nums flex-shrink-0">
                {overdue ? "Late" : `${mm}:${String(ss).padStart(2, "0")}`}
              </span>
              <Link href="/stock-control" className="flex-shrink-0 h-12 px-4 rounded-xl bg-white text-red-700 font-bold flex items-center gap-1.5 hover:bg-red-50">
                Do the count <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          );
        })}
      </div>
    )}
    {/* Keeps the page from sitting under the pinned bar. */}
    {pinned.length > 0 && <div style={{ height: `${pinned.length * 76}px` }} aria-hidden />}
    {inline.length > 0 && (
    <div className="space-y-3 mb-4">
      {inline.map(({ r, display }) => {
        const remaining = Math.max(0, toMinutes(r.endTime) * 60 - nowSeconds);
        const mm = Math.floor(remaining / 60);
        const ss = remaining % 60;
        const urgent = remaining <= 5 * 60;
        return (
          <div
            key={r.id}
            className={cn(
              "border-2 rounded-xl px-4 py-3 flex items-center gap-4",
              urgent
                ? "bg-red-50 dark:bg-red-950/30 border-red-400 dark:border-red-700"
                : "bg-amber-50 dark:bg-amber-900/20 border-amber-400 dark:border-amber-700",
            )}
          >
            <AlarmClock className={cn(
              "w-8 h-8 flex-shrink-0 animate-pulse",
              urgent ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400",
            )} />
            <div className="flex-1 min-w-0">
              <p className={cn(
                "font-bold text-base leading-snug",
                urgent ? "text-red-800 dark:text-red-200" : "text-amber-800 dark:text-amber-200",
              )}>
                {r.title}
                {display.suffix && (
                  <span className="font-semibold"> — {display.suffix}</span>
                )}
              </p>
              <p className={cn(
                "text-sm leading-snug",
                urgent ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300",
              )}>
                {r.message}
              </p>
            </div>
            <span className={cn(
              "text-3xl font-display font-bold tabular-nums flex-shrink-0",
              urgent ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300",
            )}>
              {mm}:{String(ss).padStart(2, "0")}
            </span>
          </div>
        );
      })}
    </div>
    )}
    </>
  );
}
