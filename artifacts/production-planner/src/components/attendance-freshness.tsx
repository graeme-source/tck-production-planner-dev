/**
 * Freshness line for the Employee Records report (Graeme, 2026-09-14).
 * The report now serves from a Postgres mirror of Planday, so it loads
 * instantly — this strip says when the mirror last synced and offers a
 * manual re-pull of the recent window for out-of-band corrections
 * (a late-approved sickness, a retro shift-type edit). Lives in its own
 * file because pages/reports.tsx is frozen by the charter.
 */
import { Loader2, RefreshCw, AlertTriangle } from "lucide-react";

export function AttendanceFreshness({ syncedAt, stale, refreshing, onRefresh }: {
  syncedAt: string | null;
  stale: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const asOf = syncedAt
    ? new Date(syncedAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
    : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        {stale && <AlertTriangle className="w-4 h-4 text-amber-500" />}
        {stale
          ? "Plan Day couldn't be reached — showing the last synced data" + (asOf ? ` (${asOf})` : "")
          : asOf
            ? `Synced from Plan Day ${asOf}`
            : "Served from the local mirror"}
      </span>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-background hover:bg-secondary/60 text-foreground text-xs font-medium transition-colors disabled:opacity-50"
      >
        {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {refreshing ? "Refreshing…" : "Refresh from Plan Day"}
      </button>
    </div>
  );
}
