import React, { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AlarmClock, Beef, ClipboardCheck, ClipboardList, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { usePrepProgress } from "@/hooks/use-prep-progress";
import type { Count, PrepSectionKey } from "@/lib/prep-progress";
import { sectionTabStatus, stockCheckTabStatus, type StockTabTone, type TabStatus } from "@/lib/prep-tab-status";
import { StockCheckList, usePrepStockChecks } from "./stock-check-status-panel";
import type { PrepTarget } from "./stock-check-alarm";

// ─────────────────────────────────────────────────────────────────────────
// Prep section tabs (Graeme, 22 Oct 2026):
//   [Main Prep] [Bases & Sauces] [Raw Meat] [Stock Check]
//
// Each tab shows its own progress under its name so the team can see how
// far along every section is without clicking in. The three section tabs
// use the shared task count (lib/prep-progress.ts via usePrepProgress — the
// same figures as the Prepping For hub and dashboard tile); the tab you're
// on uses the station's own live count so it matches its header exactly.
//
// Stock Check replaced the separate stock-check bar above the tabs. It
// turns amber with checks outstanding, flashing red from the warning time
// and solid red after the deadline (stock-check-alarm.ts) — so the 3pm
// warning sits on the tab. Selecting it (?tab=stock-check on the current
// section's URL) shows the stock-check list with the usual entry flow.
// ─────────────────────────────────────────────────────────────────────────

const STOCK_TAB = "stock-check";

const SECTIONS: ReadonlyArray<{
  key: PrepSectionKey; label: string; icon: React.ComponentType<{ className?: string }>;
  active: string; inactive: string; bar: string;
}> = [
  { key: "main_prep",  label: "Main Prep",      icon: ClipboardList,
    active: "bg-emerald-500 dark:bg-emerald-600 text-white border-emerald-600",
    inactive: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900 hover:bg-emerald-100 dark:hover:bg-emerald-950/60",
    bar: "bg-emerald-500" },
  { key: "prep_bases", label: "Bases & Sauces", icon: Layers,
    active: "bg-yellow-500 dark:bg-yellow-600 text-white border-yellow-600",
    inactive: "bg-yellow-50 dark:bg-yellow-950/30 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-900 hover:bg-yellow-100 dark:hover:bg-yellow-950/60",
    bar: "bg-yellow-500" },
  { key: "prep_meat",  label: "Raw Meat",       icon: Beef,
    active: "bg-rose-500 dark:bg-rose-600 text-white border-rose-600",
    inactive: "bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-900 hover:bg-rose-100 dark:hover:bg-rose-950/60",
    bar: "bg-rose-500" },
];

const STOCK_TONES: Record<StockTabTone, { active: string; inactive: string; bar: string }> = {
  neutral: {
    active: "bg-sky-600 text-white border-sky-700",
    inactive: "bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-900 hover:bg-sky-100 dark:hover:bg-sky-950/60",
    bar: "bg-sky-500",
  },
  done: {
    active: "bg-sky-600 text-white border-sky-700",
    inactive: "bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-900 hover:bg-sky-100 dark:hover:bg-sky-950/60",
    bar: "bg-emerald-500",
  },
  pending: {
    active: "bg-amber-500 text-white border-amber-600",
    inactive: "bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 border-amber-400 dark:border-amber-700 hover:bg-amber-200 dark:hover:bg-amber-900/60",
    bar: "bg-amber-500",
  },
  // Red tones are white-on-red whether selected or not: the alarm must be
  // unmissable from any tab. The warning flashes (stock-alarm-flash).
  warning: { active: "bg-red-600 text-white border-red-800 ring-4 ring-red-300", inactive: "bg-red-600 text-white border-red-700", bar: "bg-white" },
  overdue: { active: "bg-red-700 text-white border-red-900 ring-4 ring-red-300", inactive: "bg-red-700 text-white border-red-800", bar: "bg-white" },
};

/** True when the Stock Check tab is the one selected. */
export function usePrepStockTabOpen(): boolean {
  return new URLSearchParams(useSearch()).get("tab") === STOCK_TAB;
}

export interface PrepSectionTabsProps {
  /** The plan in the URL — tab hops keep it (and ?direct / ?from). */
  planId: number;
  /** The section this screen is (the selected tab unless Stock Check is). */
  current: PrepSectionKey;
  /** The plan being prepped FOR — whose progress the tabs show. */
  progressPlanId: number | null | undefined;
  /** This section's own live count, so its tab matches its header. */
  currentProgress?: Count | null;
  /** Stock checks: the day readings are recorded against + prep target. */
  checkDate: string;
  prepTarget: PrepTarget | null;
}

export function PrepSectionTabs({ planId, current, progressPlanId, currentProgress, checkDate, prepTarget }: PrepSectionTabsProps) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const reducedMotion = usePrefersReducedMotion();
  const stockOpen = usePrepStockTabOpen();
  const { data: progress } = usePrepProgress(progressPlanId, { refetchInterval: 15_000 });
  const stock = usePrepStockChecks(checkDate, prepTarget);

  // Keep every other query param (?direct=1, ?from=dashboard) across hops.
  const hrefFor = (section: PrepSectionKey, stockTab: boolean) => {
    const qs = new URLSearchParams(search);
    if (stockTab) qs.set("tab", STOCK_TAB); else qs.delete("tab");
    const s = qs.toString();
    return `/plans/${planId}/station/${section}${s ? `?${s}` : ""}`;
  };

  const stockStatus = stock.isLoading ? stockCheckTabStatus(null) : stockCheckTabStatus({ ...stock.alarm, state: stock.state });
  const stockTone = STOCK_TONES[stockStatus.tone];
  const stockRed = stockStatus.tone === "warning" || stockStatus.tone === "overdue";

  return (
    <div
      role="tablist"
      aria-label="Prep sections"
      className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-card border border-border rounded-2xl p-2"
    >
      {SECTIONS.map(s => {
        const isActive = !stockOpen && s.key === current;
        const count = s.key === current && currentProgress ? currentProgress : progress?.bySection[s.key];
        return (
          <TabButton
            key={s.key}
            active={isActive}
            onClick={() => navigate(hrefFor(s.key, false))}
            icon={s.icon}
            label={s.label}
            status={sectionTabStatus(count)}
            className={isActive ? s.active : s.inactive}
            barClass={isActive ? "bg-white" : s.bar}
          />
        );
      })}
      <TabButton
        active={stockOpen}
        onClick={() => navigate(hrefFor(current, true))}
        icon={stockRed ? AlarmClock : ClipboardCheck}
        label="Stock Check"
        status={stockStatus}
        className={cn(stockOpen ? stockTone.active : stockTone.inactive, stockStatus.tone === "warning" && !reducedMotion && "stock-alarm-flash")}
        barClass={stockOpen && !stockRed ? "bg-white" : stockTone.bar}
        alert={stockRed}
      />
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, status, className, barClass, alert }: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  status: TabStatus;
  className: string;
  barClass: string;
  alert?: boolean;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex flex-col items-stretch justify-center gap-1 min-h-[4.5rem] px-3 py-2.5 rounded-xl border-2 text-left transition-colors",
        active && "shadow-md",
        className,
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        <Icon className="w-5 h-5 flex-shrink-0" />
        {/* Never truncate: long names wrap onto a second line. */}
        <span className="font-bold text-base lg:text-lg leading-tight break-words">{label}</span>
      </span>
      <span
        className={cn("text-sm tabular-nums leading-tight", alert || active ? "font-semibold" : "font-medium opacity-90")}
        role={alert ? "alert" : undefined}
        aria-live={alert ? "assertive" : undefined}
      >
        {status.line}
      </span>
      <span className={cn("block w-full h-1.5 rounded-full overflow-hidden", active || alert ? "bg-white/30" : "bg-black/10 dark:bg-white/10", status.pct == null && "invisible")}>
        <span className={cn("block h-full rounded-full transition-all", barClass)} style={{ width: `${status.pct ?? 0}%` }} />
      </span>
    </button>
  );
}

/** The Stock Check tab's body — what the old bar's "Show" opened: today's
 *  stock checks with the usual entry flow. */
export function PrepStockCheckTabBody({ checkDate, prepTarget }: { checkDate: string; prepTarget: PrepTarget | null }) {
  const checks = usePrepStockChecks(checkDate, prepTarget);
  const [activeId, setActiveId] = useState<number | null>(null);
  const red = checks.state === "warning" || checks.state === "overdue";
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className={cn(
        "px-4 py-3 border-b border-border/60 flex items-center gap-2",
        red ? "bg-red-600 text-white" : checks.state === "pending" ? "bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200" : "",
      )}>
        {red ? <AlarmClock className="w-5 h-5 flex-shrink-0" /> : <ClipboardCheck className="w-5 h-5 flex-shrink-0 text-sky-600" />}
        <h2 className="font-semibold text-base">
          {checks.isLoading ? "Loading stock checks…" : checks.state === "none" ? "No stock checks are due today" : checks.headline}
        </h2>
      </div>
      {!checks.isLoading && (
        <StockCheckList checkDate={checkDate} checks={checks} activeId={activeId} setActiveId={setActiveId} />
      )}
    </div>
  );
}
