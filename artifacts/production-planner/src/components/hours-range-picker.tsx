/**
 * The dates for the record's "Hours worked" panel and the team's "Hours vs
 * contract" view. It is the standard period picker (as on Numbers — Graeme,
 * 25 Nov 2026), kept controlled so both views share one range shape and the
 * record's summary line can read the same default from the same cache.
 */
import { PeriodPicker, type PeriodChoice } from "@/components/period-picker";
import { customWindow, londonDayString, periodWindow, type PeriodPresetId } from "@/lib/roas";

export interface HoursRange { preset: PeriodChoice; from: string; to: string }

/** Opens on Last 3 months — the old default was its own "3 months" (13 full
 *  weeks plus this week); this is the nearest standard period. */
const DEFAULT_PRESET: PeriodPresetId = "last3Months";

export function defaultHoursRange(): HoursRange {
  const win = periodWindow(DEFAULT_PRESET, new Date());
  return { preset: DEFAULT_PRESET, from: win.from, to: win.to };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function HoursRangePicker({ value, onChange }: { value: HoursRange; onChange: (r: HoursRange) => void }) {
  const now = new Date();
  const todayStr = londonDayString(now);
  const period = value.preset === "custom" ? customWindow(value.from, value.to, now) : periodWindow(value.preset, now);
  return (
    <PeriodPicker
      periodId={value.preset}
      period={period}
      todayStr={todayStr}
      // Partial weeks at either end are shown but left out of the average.
      note="the weekly average counts whole Monday–Sunday weeks only"
      onPreset={(id) => {
        const win = periodWindow(id, new Date());
        onChange({ preset: id, from: win.from, to: win.to });
      }}
      onDate={(field, v) => {
        const next = { from: value.from, to: value.to, [field]: v };
        // Only ask the server for a range it will accept.
        if (ISO.test(next.from) && ISO.test(next.to) && next.from <= next.to && next.to <= todayStr) {
          onChange({ preset: "custom", ...next });
        }
      }}
    />
  );
}
