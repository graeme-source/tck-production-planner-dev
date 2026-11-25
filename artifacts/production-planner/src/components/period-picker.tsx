/**
 * The period selector: the presets and a custom From/To. The ONE date-range
 * picker — Numbers' Order Analysis, Ads, KPIs, P&L, Defects, Team
 * efficiency, People hours and reviews all use it, so every page offers the
 * same periods in the same place (Graeme, 25 Nov 2026: "all date selectors
 * across all pages are the same").
 *
 * A page that can't do a preset (e.g. it only has finished days) keeps the
 * button but disables it with a short reason — never a different picker.
 * A page with a period of its own (e.g. "Since last review") adds it as an
 * extra button at the start of the same row.
 */
import { useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Calendar } from "lucide-react";
import {
  customWindow, DEFAULT_PERIOD, londonDayString, PERIOD_PRESETS, periodWindow,
  type PeriodPresetId, type PeriodWindow,
} from "@/lib/roas";

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
  return `min-h-10 text-sm font-medium px-3.5 py-2 rounded-lg transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${
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
  const reasons: Array<{ key: string; label: string; reason: string }> = [];
  for (const x of extras ?? []) {
    if (x.disabled && x.reason) reasons.push({ key: x.key, label: x.label, reason: x.reason });
  }
  for (const p of PERIOD_PRESETS) {
    const reason = disabled?.[p.id];
    if (reason) reasons.push({ key: p.id, label: p.label, reason });
  }
  return (
    <div className={`glass-panel p-4 rounded-2xl space-y-3 min-w-0 ${className ?? ""}`}>
      {/* Presets, in time order — Today, Yesterday, Today & Yesterday, then
          the longer ranges. They wrap onto further rows on an iPad. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Period">
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
      <div className="flex items-center gap-3 flex-wrap">
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
