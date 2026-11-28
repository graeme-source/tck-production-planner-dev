/**
 * The period selector: the presets and a custom From/To. The ONE date-range
 * picker — Numbers' Analysis, Ads, KPIs, P&L, Defects, Team
 * efficiency, People hours and reviews all use it, so every page offers the
 * same periods in the same place (Graeme, 25 Nov 2026: "all date selectors
 * across all pages are the same").
 *
 * A page that can't do a preset (e.g. it only has finished days) keeps the
 * button but disables it with a short reason — never a different picker.
 * A page with a period of its own (e.g. "Since last review") adds it as an
 * extra button at the start of the same row.
 *
 * On a phone (narrower than an iPad, < 768 px) it shrinks to one row of
 * small chips you swipe sideways, with the From/To dates behind a "Dates"
 * chip, so it doesn't fill the screen before the figures (Graeme, 28 Nov
 * 2026: "without having it take up 50, 60, 70% of the vertical height").
 * iPad and desktop are unchanged.
 */
import { useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Calendar } from "lucide-react";
import {
  customWindow, DEFAULT_PERIOD, londonDayString, PERIOD_PRESETS, periodWindow,
  type PeriodPresetId, type PeriodWindow,
} from "@/lib/roas";

/** Phone width — the same breakpoint as hooks/use-mobile.tsx. */
export const PHONE_MAX_WIDTH = 767;

/** Is this screen phone-sized right now? (false where there's no window). */
export function isPhoneWidth(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(`(max-width: ${PHONE_MAX_WIDTH}px)`).matches === true;
}

/** A page's opening period: Today on a phone, else the page's own default
 *  (Graeme, 28 Nov 2026: on a phone the Business pages open on Today). */
export function openingPeriod(desktopDefault: PeriodPresetId): PeriodPresetId {
  return isPhoneWidth() ? "today" : desktopDefault;
}

/** A period's days spelled out for a human — "Wed 17 Sep", or a range. */
export function describePeriod(period: PeriodWindow): string {
  if (period.empty) return "No complete days yet";
  const day = (d: string) => format(new Date(`${d}T12:00:00`), "EEE d MMM");
  if (period.dayCount === 1) return day(period.from);
  return `${day(period.from)} – ${day(period.to)} · ${period.dayCount} days`;
}

export type PeriodChoice = PeriodPresetId | "custom";

/** A period selection of its own, for a page with nothing else tied to it. */
export function usePeriodChoice(initial: PeriodPresetId = DEFAULT_PERIOD) {
  const now = new Date();
  const todayStr = londonDayString(now);
  const [periodId, setPeriodId] = useState<PeriodChoice>(initial);
  const [customFrom, setCustomFrom] = useState(() => periodWindow(initial, now).from);
  const [customTo, setCustomTo] = useState(() => periodWindow(initial, now).to);
  const period = useMemo(
    () => (periodId === "custom" ? customWindow(customFrom, customTo, now) : periodWindow(periodId, now)),
    [periodId, customFrom, customTo, todayStr],
  );
  return {
    periodId,
    period,
    todayStr,
    onPreset: (id: PeriodPresetId) => {
      const win = periodWindow(id, new Date());
      setCustomFrom(win.from);
      setCustomTo(win.to);
      setPeriodId(id);
    },
    onDate: (field: "from" | "to", value: string) => {
      if (field === "from") setCustomFrom(value);
      else setCustomTo(value);
      setPeriodId("custom");
    },
    /** Set both dates at once, as a custom range — e.g. to carry on from the
     *  dates an extra option was showing before one of them is edited. */
    setRange: (from: string, to: string) => {
      setCustomFrom(from);
      setCustomTo(to);
      setPeriodId("custom");
    },
  };
}

/** A page's own period beside the standard presets, e.g. "Since last review". */
export interface PeriodExtra {
  key: string;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** Why it's disabled, shown under the buttons (there's no hover on an iPad). */
  reason?: string;
}

function presetButton(active: boolean): string {
  // Phone: small chips that don't wrap; md and up: the full-size buttons.
  return `shrink-0 whitespace-nowrap min-h-8 text-xs px-2.5 py-1 md:min-h-10 md:text-sm md:px-3.5 md:py-2 font-medium rounded-lg transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${
    active
      ? "bg-primary text-primary-foreground border-primary"
      : "border-border text-muted-foreground enabled:hover:text-foreground enabled:hover:bg-secondary"
  }`;
}

export function PeriodPicker({
  periodId, period, todayStr, onPreset, onDate, children,
  disabled, extras, minDate, maxDate, note, className,
}: {
  periodId: PeriodChoice;
  period: PeriodWindow;
  todayStr: string;
  onPreset: (id: PeriodPresetId) => void;
  onDate: (field: "from" | "to", value: string) => void;
  /** Sits beside the dates, e.g. a load error. */
  children?: ReactNode;
  /** Presets this page can't do, each with a short reason. The button stays
   *  in its place, greyed out, and the reason shows under the row. */
  disabled?: Partial<Record<PeriodPresetId, string>>;
  /** The page's own periods, before the standard presets. */
  extras?: PeriodExtra[];
  /** Earliest date the From/To inputs allow (e.g. where the history starts). */
  minDate?: string;
  /** Latest date the To input allows; defaults to today. */
  maxDate?: string;
  /** Added to the caption, e.g. "only finished days are counted". */
  note?: ReactNode;
  className?: string;
}) {
  // Greyed-out buttons with the same reason share one line:
  // "Last 6 months, Last 12 months: up to 3 months at a time".
  const reasons: Array<{ key: string; label: string; reason: string }> = [];
  const addReason = (key: string, label: string, reason: string) => {
    const same = reasons.find((r) => r.reason === reason);
    if (same) same.label += `, ${label}`;
    else reasons.push({ key, label, reason });
  };
  for (const x of extras ?? []) {
    if (x.disabled && x.reason) addReason(x.key, x.label, x.reason);
  }
  for (const p of PERIOD_PRESETS) {
    const reason = disabled?.[p.id];
    if (reason) addReason(p.id, p.label, reason);
  }
  // Phone only: the From/To dates are tucked behind a "Dates" chip unless a
  // custom range is in use.
  const [datesOpen, setDatesOpen] = useState(false);
  const showDates = datesOpen || periodId === "custom";
  return (
    <div className={`glass-panel p-3 md:p-4 rounded-2xl space-y-2 md:space-y-3 min-w-0 ${className ?? ""}`}>
      {/* Presets, in time order — Today, Yesterday, Today & Yesterday, then
          the longer ranges. They wrap onto further rows on an iPad; on a
          phone they're one row you swipe sideways. */}
      <div className="flex flex-nowrap overflow-x-auto overscroll-x-contain -mx-3 px-3 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible gap-1.5 md:gap-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Period">
        {extras?.map((x) => (
          <button
            key={x.key}
            type="button"
            onClick={x.onClick}
            disabled={x.disabled}
            aria-pressed={x.active}
            className={presetButton(x.active)}
          >
            {x.label}
          </button>
        ))}
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPreset(p.id)}
            disabled={Boolean(disabled?.[p.id])}
            aria-pressed={periodId === p.id}
            className={presetButton(periodId === p.id)}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setDatesOpen((o) => !o)}
          aria-expanded={showDates}
          className={`md:hidden inline-flex items-center gap-1 ${presetButton(periodId === "custom")}`}
        >
          <Calendar className="w-3.5 h-3.5" /> Dates
        </button>
      </div>
      {reasons.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {reasons.map((r, i) => (
            <span key={r.key}>
              {i > 0 && " · "}
              <span className="font-medium">{r.label}</span>: {r.reason}
            </span>
          ))}
        </p>
      )}
      {/* Custom date inputs */}
      <div className={`${showDates ? "flex" : "hidden md:flex"} items-center gap-3 flex-wrap`}>
        <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">From</label>
          <input
            type="date"
            value={period.from}
            min={minDate}
            max={period.to}
            onChange={(e) => onDate("from", e.target.value)}
            className="min-h-10 text-sm bg-secondary border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">To</label>
          <input
            type="date"
            value={period.to}
            min={period.from || minDate}
            max={maxDate ?? todayStr}
            onChange={(e) => onDate("to", e.target.value)}
            className="min-h-10 text-sm bg-secondary border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        {children}
      </div>
      {/* Exactly which days are being counted, always spelled out. */}
      <p className="text-xs text-muted-foreground">
        {describePeriod(period)}
        {period.includesToday && " · today is still running, so these figures are partial"}
        {note && <> · {note}</>}
      </p>
    </div>
  );
}
