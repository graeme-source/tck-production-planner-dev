import { WifiOff } from "lucide-react";

/**
 * Shows a subtle warning when station data is stale (>30s since last successful fetch).
 * Placed in the station header area to keep users informed without being intrusive.
 */
export function StaleIndicator({ staleSeconds, isStale }: { staleSeconds: number; isStale: boolean }) {
  if (!isStale) return null;

  const mins = Math.floor(staleSeconds / 60);
  const secs = staleSeconds % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-2.5 py-1">
      <WifiOff className="w-3.5 h-3.5" />
      <span>Data {timeStr} old</span>
    </div>
  );
}
