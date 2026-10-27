/**
 * Today's new-customer ROAS on the "New customers today" tile (Graeme,
 * 2026-10-27): under the sales and as big as them, coloured green / yellow /
 * red against the new-customer ROAS target — the same bands and settings as
 * the ROAS cards below. Today's ad spend syncs through the day, so the
 * figure moves as both sides fill in.
 */
import { cn } from "@/lib/utils";
import { ROAS_FIGURE_CLASS, roasBand, todayNcRoasPercent } from "@/lib/ad-efficiency";
import { useAdEfficiencySettings, useSpendSources } from "./api";

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
    </div>
  );
}
