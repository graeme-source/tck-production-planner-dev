import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import type { StationType } from "./constants";

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
  /** Prep-only condition: hide unless today still has unrecorded stock checks. */
  onlyIfStockChecksOutstanding?: boolean;
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

/** Live count of today's unrecorded stock checks — same maths as the prep
 *  stations' StockCheckStatusPanel. Only polled while `enabled`. */
function useOutstandingStockChecks(enabled: boolean, dateStr: string, dayName: string): number | null {
  const { data } = useQuery({
    queryKey: ["reminder-stock-checks", dateStr],
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/production-plans/stock-checks?date=${dateStr}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{
        checks: Array<{ ingredientId: number }>;
        stockIngredients: Array<{ id: number; stockCheckFrequency: string; stockCheckDay: string | null }>;
      }>;
    },
  });
  if (!enabled || !data) return null;
  const due = (data.stockIngredients ?? []).filter(
    it => it.stockCheckFrequency !== "weekly" || it.stockCheckDay === dayName,
  );
  const checkedIds = new Set((data.checks ?? []).map(c => c.ingredientId));
  return due.filter(it => !checkedIds.has(it.id)).length;
}

export function StationReminderBanner({ stationType, plan }: {
  stationType: StationType;
  plan: ProductionPlanDetail | undefined;
}) {
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

  // 1s tick drives the countdown display and the window check.
  const [nowParts, setNowParts] = useState(londonNowParts);
  useEffect(() => {
    const id = setInterval(() => setNowParts(londonNowParts()), 1000);
    return () => clearInterval(id);
  }, []);

  const reminders = parseReminders(remindersRaw);
  const nowSeconds = nowParts.h * 3600 + nowParts.m * 60 + nowParts.s;

  // Reminders only fire inside a live production day — never on completed plans.
  const planLive = !!plan && plan.status !== "complete";

  const inWindow = (r: TimedReminder) =>
    r.enabled &&
    r.stations.includes(stationType) &&
    nowSeconds >= toMinutes(r.startTime) * 60 &&
    nowSeconds < toMinutes(r.endTime) * 60;

  const candidates = planLive ? reminders.filter(inWindow) : [];

  // Only hit the stock-check endpoint while a conditional reminder is showing.
  const needsStockCheckCount = candidates.some(r => r.onlyIfStockChecksOutstanding);
  const outstanding = useOutstandingStockChecks(needsStockCheckCount, nowParts.dateStr, nowParts.dayName);

  const active = candidates.filter(r =>
    !r.onlyIfStockChecksOutstanding || (outstanding !== null && outstanding > 0),
  );

  if (active.length === 0) return null;

  return (
    <div className="space-y-3 mb-4">
      {active.map(r => {
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
                {r.onlyIfStockChecksOutstanding && outstanding !== null && (
                  <span className="font-semibold"> — {outstanding} outstanding</span>
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
  );
}
