/**
 * New vs returning customers for the Order Analysis period (Objective I).
 *
 * Graeme, 2026-10-13: "Of the orders that I received… what percentage of
 * those orders were new customers, and what percentage were returning? So
 * it's going to be a 25/75, for example."
 *
 * Every figure comes from the server's trend series totals for the same
 * from..to as the tiles (GET /api/founder-numbers/trend), so the counts
 * reconcile with the New Customers tile and the AOV tile's paid orders:
 *
 *   new        orders tagged "new-customer" in Shopify (the tile's rule)
 *   returning  every other PAID order — subscriptions and wholesale included
 *   £0 resends are left out of both sides, as they are out of AOV.
 */
import { Users, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendChip } from "@/components/sales-trend-panel";
import { useSalesTrend } from "@/hooks/use-sales-trend";
import { splitPercents } from "@/lib/sales-trend-view";

const n = (v: number) => v.toLocaleString("en-GB");

export function NewVsReturningCard({
  from,
  to,
  periodLabel,
  trendOpen,
  onToggleTrend,
}: {
  from: string;
  to: string;
  periodLabel: string;
  trendOpen: boolean;
  onToggleTrend: () => void;
}) {
  const { data, isLoading, error } = useSalesTrend(from, to, null);
  const t = data?.totals;
  const byOrders = splitPercents(t?.newCustomerSharePercent);
  const bySales = splitPercents(t?.newCustomerRevenueSharePercent);
  const resends = t ? t.orders - t.paidOrders : 0;

  return (
    <button
      type="button"
      onClick={onToggleTrend}
      aria-expanded={trendOpen}
      className={`glass-panel p-6 rounded-2xl flex flex-col gap-3 col-span-full text-left w-full hover-lift transition-all cursor-pointer ${trendOpen ? "ring-2 ring-primary" : "ring-0"}`}
    >
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-xl bg-primary/10 text-primary">
          <Users className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-display font-bold leading-tight">New vs returning customers — {periodLabel}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Share of the paid orders received in this period</p>
        </div>
      </div>

      {isLoading ? (
        <>
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-full rounded-full" />
        </>
      ) : error ? (
        <p className="text-destructive text-sm flex items-center gap-1">
          <AlertCircle className="w-4 h-4" /> {(error as Error).message}
        </p>
      ) : !t || !byOrders ? (
        <p className="text-3xl font-display font-bold text-muted-foreground">
          — <span className="text-sm font-sans font-normal">No paid orders in this period</span>
        </p>
      ) : (
        <>
          <p className="text-3xl font-display font-bold">
            <span className="text-primary">{byOrders.new}% new</span>
            <span className="text-muted-foreground font-normal"> · </span>
            <span>{byOrders.returning}% returning</span>
          </p>
          {/* Two-colour bar: brand green for new, a calm neutral for returning. */}
          <div
            className="flex h-4 w-full overflow-hidden rounded-full bg-muted-foreground/20"
            role="img"
            aria-label={`${byOrders.new}% new customers, ${byOrders.returning}% returning`}
          >
            <div className="h-full bg-primary transition-all" style={{ width: `${t.newCustomerSharePercent ?? 0}%` }} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-primary" aria-hidden="true" />
              <strong>{n(t.newCustomerPaidOrders)}</strong> new
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />
              <strong>{n(t.returningOrders)}</strong> returning
            </span>
            <span className="text-muted-foreground">of {n(t.paidOrders)} orders</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {bySales ? `By sales: ${bySales.new}% new · ${bySales.returning}% returning` : "By sales: no sales in this period"}
            {resends > 0 && ` · ${n(resends)} £0 resend${resends === 1 ? "" : "s"} not counted`}
          </p>
        </>
      )}

      <div className="mt-auto pt-1">
        <TrendChip open={trendOpen} />
      </div>
    </button>
  );
}
