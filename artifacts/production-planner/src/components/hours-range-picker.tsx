/**
 * Range picker shared by the record's "Hours worked" panel and the team's
 * "Hours vs contract" view: Last 4 weeks / 3 months / 6 months / Custom.
 * Big tap targets for the iPad.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { RANGE_PRESETS, presetRange, londonToday, type RangePreset } from "@/lib/hours-worked-view";

export interface HoursRange { preset: RangePreset; from: string; to: string }

export function defaultHoursRange(): HoursRange {
  return { preset: "3m", ...presetRange("3m", londonToday()) };
}

export function HoursRangePicker({ value, onChange }: { value: HoursRange; onChange: (r: HoursRange) => void }) {
  const today = londonToday();
  const [draft, setDraft] = useState({ from: value.from, to: value.to });
  const pick = (preset: RangePreset) => {
    if (preset === "custom") {
      setDraft({ from: value.from, to: value.to });
      onChange({ ...value, preset });
    } else {
      onChange({ preset, ...presetRange(preset, today) });
    }
  };
  const setCustom = (next: { from: string; to: string }) => {
    setDraft(next);
    // Only ask the server for a range it will accept.
    if (next.from && next.to && next.from <= next.to && next.to <= today) onChange({ preset: "custom", ...next });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Date range">
        {RANGE_PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => pick(p.key)}
            aria-pressed={value.preset === p.key}
            className={cn(
              "h-12 px-4 rounded-2xl border-2 text-base font-bold transition-colors",
              value.preset === p.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-base font-semibold">
            From
            <input type="date" value={draft.from} max={draft.to || today}
              onChange={e => setCustom({ ...draft, from: e.target.value })}
              className="h-12 px-3 rounded-xl border-2 border-border bg-card text-base" />
          </label>
          <label className="flex items-center gap-2 text-base font-semibold">
            To
            <input type="date" value={draft.to} min={draft.from} max={today}
              onChange={e => setCustom({ ...draft, to: e.target.value })}
              className="h-12 px-3 rounded-xl border-2 border-border bg-card text-base" />
          </label>
        </div>
      )}
    </div>
  );
}
