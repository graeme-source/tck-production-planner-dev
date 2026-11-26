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
 *
 * Revenue first (Graeme, 26 Nov 2026: "change this to revenue and calculate
 * the percentage in the same way, and actually show the revenue"): the
 * headline is the split of SALES — new-customer revenue ÷ all revenue, the
 * server's newCustomerSplit rule — with the £ either side; the order split
 * is the line under it. The graph opens on revenue, Orders a flick away.
 */
import { AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendChip } from "@/components/sales-trend-panel";
import { useSalesTrend } from "@/hooks/use-sales-trend";
import { returningRevenueOf, splitPercents } from "@/lib/sales-trend-view";

const n = (v: number) => v.toLocaleString("en-GB");
const gbp = (v: number) => v.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

export function NewVsReturningCard({
  from,
  to,
  periodLabel,
  trendOpen,
  onToggleTrend,
  grade,
}: {
  from: string;
  to: string;
  periodLabel: string;
  trendOpen: boolean;
  onToggleTrend: () => void;
  /** The grade band across the top. */
  grade?: React.ReactNode;
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
      className={`glass-panel p-5 rounded-2xl overflow-hidden flex flex-col gap-3 text-left w-full hover-lift transition-all cursor-pointer ${trendOpen ? "ring-2 ring-primary" : "ring-0"}`}
    >
      <div className="-mx-5 -mt-5 mb-1">{grade}</div>

      {isLoading ? (
        <>
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-full rounded-full" />
        </>
      ) : error ? (
        <p className="text-destructive text-sm flex items-center gap-1">
          <AlertCircle className="w-4 h-4" /> {(error as Error).message}
        </p>
      ) : !t || !bySales ? (
        <p className="text-2xl font-display font-bold text-muted-foreground">
          — <span className="text-sm font-sans font-normal">No sales in this period</span>
        </p>
      ) : (
        <>
          {/* Panel-sized like every other Numbers tile (13 Nov 2026). */}
          <p className="text-2xl font-display font-bold leading-tight">
            <span className="text-primary">{bySales.new}% new</span>
            <span className="text-muted-foreground font-normal"> · </span>
            <span>{bySales.returning}% returning</span>
          </p>
          {/* Two-colour bar: brand green for new, a calm neutral for returning. */}
          <div
            className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted-foreground/20"
            role="img"
            aria-label={`${bySales.new}% of sales from new customers, ${bySales.returning}% returning`}
          >
            <div className="h-full bg-primary transition-all" style={{ width: `${t.newCustomerRevenueSharePercent ?? 0}%` }} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-primary" aria-hidden="true" />
              <strong className="tabular-nums">{gbp(t.newCustomerRevenue)}</strong> new
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />
              <strong className="tabular-nums">{gbp(returningRevenueOf(t))}</strong> returning
            </span>
            <span className="text-muted-foreground">of {gbp(t.revenue)} sales</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {byOrders
              ? `By orders: ${byOrders.new}% new · ${byOrders.returning}% returning (${n(t.newCustomerPaidOrders)} · ${n(t.returningOrders)} of ${n(t.paidOrders)})`
              : "By orders: no paid orders in this period"}
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
