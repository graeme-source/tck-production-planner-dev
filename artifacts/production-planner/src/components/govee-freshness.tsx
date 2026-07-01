// Shared freshness helper for the Govee fridge/freezer sensors.
//
// Govee's API gives us no battery level, so "is this reading trustworthy?"
// comes down to whether the sensor is still reporting. The backend marks a
// sensor `stale` once it hasn't sent a live (online) reading for the configured
// window (default 1h). A stale reading is a frozen last-known value — exactly
// the "looks fine but the battery's dead" trap — so we surface it loudly and
// timestamp when the data was actually last live.

import { formatDistanceToNowStrict, format } from "date-fns";

export interface GoveeSensorFreshness {
  online?: boolean | null;
  stale?: boolean;
  /** When the sensor was last actually online/reporting (ISO). */
  lastOnlineAt?: string | null;
}

export interface FreshnessInfo {
  stale: boolean;
  /** Short inline label, e.g. "Live · updated 4m ago" / "No signal · last live 2h ago". */
  label: string;
  /** Longer tooltip / helper text. */
  title: string;
}

export function freshnessInfo(s: GoveeSensorFreshness): FreshnessInfo {
  const stale = Boolean(s.stale);
  const last = s.lastOnlineAt ? new Date(s.lastOnlineAt) : null;

  if (stale) {
    if (!last) {
      return { stale, label: "No signal — never reported", title: "This sensor has never sent a reading. Check it's powered and online." };
    }
    return {
      stale,
      label: `No signal · last live ${formatDistanceToNowStrict(last)} ago`,
      title: `Last live reading ${format(last, "EEE d MMM, HH:mm")}. The reading shown is frozen — check or replace the sensor's battery.`,
    };
  }
  return {
    stale,
    label: last ? `Live · updated ${formatDistanceToNowStrict(last)} ago` : "Live",
    title: last ? `Last live reading ${format(last, "HH:mm")}.` : "Reporting live.",
  };
}

/** Compact live/stale pill with a status dot. */
export function FreshnessBadge({ sensor, className = "" }: { sensor: GoveeSensorFreshness; className?: string }) {
  const f = freshnessInfo(sensor);
  return (
    <span
      title={f.title}
      className={`inline-flex items-center gap-1 text-xs font-medium ${f.stale ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${f.stale ? "bg-red-500" : "bg-emerald-500 animate-pulse"}`} />
      <span className="truncate">{f.label}</span>
    </span>
  );
}
