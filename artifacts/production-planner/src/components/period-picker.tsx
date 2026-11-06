/**
 * The period selector: the presets and a custom From/To. Shared by Numbers'
 * Order Analysis and the Ads page, so they always offer the same periods.
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
export function usePeriodChoice() {
  const now = new Date();
  const todayStr = londonDayString(now);
  const [periodId, setPeriodId] = useState<PeriodChoice>(DEFAULT_PERIOD);
  const [customFrom, setCustomFrom] = useState(() => periodWindow(DEFAULT_PERIOD, now).from);
  const [customTo, setCustomTo] = useState(() => periodWindow(DEFAULT_PERIOD, now).to);
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
  };
}

export function PeriodPicker({ periodId, period, todayStr, onPreset, onDate, children }: {
  periodId: PeriodChoice;
  period: PeriodWindow;
  todayStr: string;
  onPreset: (id: PeriodPresetId) => void;
  onDate: (field: "from" | "to", value: string) => void;
  /** Sits beside the dates, e.g. a load error. */
  children?: ReactNode;
}) {
  return (
    <div className="glass-panel p-4 rounded-2xl space-y-3">
      {/* Presets. Yesterday and Today lead — the precursor to the longer
          ranges — and the rest follow in increasing length. */}
      <div className="flex flex-wrap gap-2">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => onPreset(p.id)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all border ${
              periodId === p.id
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {/* Custom date inputs */}
      <div className="flex items-center gap-3 flex-wrap">
        <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">From</label>
          <input
            type="date"
            value={period.from}
            max={period.to}
            onChange={(e) => onDate("from", e.target.value)}
            className="text-sm bg-secondary border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">To</label>
          <input
            type="date"
            value={period.to}
            min={period.from}
            max={todayStr}
            onChange={(e) => onDate("to", e.target.value)}
            className="text-sm bg-secondary border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        {children}
      </div>
      {/* Exactly which days are being counted, always spelled out. */}
      <p className="text-xs text-muted-foreground">
        {describePeriod(period)}
        {period.includesToday && " · today is still running, so these figures are partial"}
      </p>
    </div>
  );
}
