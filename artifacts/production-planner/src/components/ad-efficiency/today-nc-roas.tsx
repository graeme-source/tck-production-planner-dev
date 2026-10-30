/**
 * Today's new-customer ROAS on the "New customers today" tile (Graeme,
 * 2026-10-27): under the sales and as big as them, coloured green / yellow /
 * red against the new-customer ROAS target — the same bands and settings as
 * the ROAS cards below. Today's ad spend syncs through the day, so the
 * figure moves as both sides fill in.
 *
 * "Refresh from Meta" sits on the tile too (Graeme, 30 Oct 2026: "I keep
 * having to go down to the date range section… I want it available in this
 * panel"). The tile is itself a button (it opens the trend), so this is a
 * role="button" span that stops the tap reaching the tile.
 */
import type { KeyboardEvent, MouseEvent } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROAS_FIGURE_CLASS, roasBand, todayNcRoasPercent } from "@/lib/ad-efficiency";
import { useAdEfficiencySettings, useRefreshFromMeta, useSpendSources } from "./api";

export function TodayNcRoas({ date, newCustomerRevenue }: { date: string; newCustomerRevenue: number }) {
  const settings = useAdEfficiencySettings().data?.settings;
  const spendDay = useSpendSources(date, date).data?.days.find(d => d.date === date);
  const spend = spendDay?.amount ?? null;
  const pct = todayNcRoasPercent(newCustomerRevenue, spend);
  const target = settings?.ncRoas7dTargetPct ?? 0;
  const band = settings ? roasBand(pct, target, settings.amberWidthPct) : "neutral";
  return (
    <div>
      <p className={cn("text-3xl font-display font-bold tabular-nums", ROAS_FIGURE_CLASS[band])}>
        {pct == null ? "—" : `${Math.round(pct)}%`}
      </p>
      <p className="text-xs text-muted-foreground">
        New-customer ROAS{spend != null ? ` · £${Math.round(spend).toLocaleString("en-GB")} ad spend so far` : " · waiting for today's ad spend"}
        {target > 0 ? ` · target ${Math.round(target)}%` : ""}
      </p>
      <MetaRefresh />
    </div>
  );
}

function MetaRefresh() {
  const refresh = useRefreshFromMeta();
  const run = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!refresh.isPending) refresh.mutate();
  };
  const r = refresh.data;
  const note = refresh.isError ? (refresh.error as Error).message
    : r && !r.connected ? "Meta isn't connected"
    : r && !r.ok ? (r.error ?? r.message)
    : r ? `Updated ${new Date(r.ranAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}`
    : null;
  const bad = refresh.isError || (r != null && (!r.connected || !r.ok));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span
        role="button"
        tabIndex={0}
        aria-disabled={refresh.isPending}
        onClick={run}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") run(e); }}
        className={cn(
          "min-h-11 px-3 rounded-xl border-2 border-border bg-background text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-secondary cursor-pointer",
          refresh.isPending && "opacity-60 cursor-wait",
        )}
      >
        {refresh.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        {refresh.isPending ? "Refreshing from Meta…" : "Refresh from Meta"}
      </span>
      {note && <span className={cn("text-xs", bad ? "text-destructive" : "text-muted-foreground")}>{note}</span>}
    </div>
  );
}
