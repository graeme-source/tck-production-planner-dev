/**
 * Klaviyo-reported email revenue for the Order Analysis period, split into
 * flows and campaigns (Graeme, 2026-11-09). Objective I.
 *
 * Figures: GET /api/klaviyo-email-revenue — Klaviyo's own attribution of
 * Placed Order value to email, by the day the order was placed, so it
 * matches Klaviyo's dashboard. It overlaps other channels (an order can be
 * credited to an email and an ad), so it is never added to anything.
 */
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronDown, Mail } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Part { revenue: number; orders: number }
export type EmailRevenueReport =
  | { connected: false }
  | { connected: true; ok: false; message: string }
  | {
    connected: true; ok: true; from: string; to: string; fetchedAt: string;
    split: Part & { campaigns: Part; flows: Part; byFlow: Array<Part & { flowId: string; name: string }> };
  };

export function useEmailRevenue(from: string, to: string) {
  return useQuery<EmailRevenueReport>({
    queryKey: ["klaviyo-email-revenue", from, to],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/klaviyo-email-revenue?${new URLSearchParams({ from, to })}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const orders = (n: number) => `${n.toLocaleString("en-GB")} order${n === 1 ? "" : "s"}`;

export function EmailRevenueCard({ from, to, periodLabel, totalSales }: {
  from: string;
  to: string;
  periodLabel: string;
  /** The period's Total Sales, for the "% of sales" line. */
  totalSales: number | null | undefined;
}) {
  const { data, isLoading, error } = useEmailRevenue(from, to);
  const [open, setOpen] = useState(false);
  const s = data && data.connected && data.ok ? data.split : null;
  const flowPct = s && s.revenue > 0 ? Math.round((s.flows.revenue / s.revenue) * 100) : null;
  const salesPct = s && totalSales && totalSales > 0 ? Math.round((s.revenue / totalSales) * 100) : null;

  return (
    <div className="glass-panel p-5 rounded-2xl overflow-hidden flex flex-col gap-3">
      {/* Panel-sized with a header bar like the other Numbers tiles
          (13 Nov 2026). */}
      <div className="-mx-5 -mt-5 mb-1 px-5 py-3 bg-sky-600 text-white">
        <p className="font-display font-bold text-lg leading-tight flex items-center gap-2">
          <Mail className="w-4 h-4 shrink-0" /> Email revenue — {periodLabel}
        </p>
        <p className="text-xs opacity-90">Klaviyo · flows and campaigns</p>
      </div>

      {isLoading ? (
        <>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full rounded-full" />
        </>
      ) : error ? (
        <p className="text-destructive text-sm flex items-center gap-1">
          <AlertCircle className="w-4 h-4" /> {(error as Error).message}
        </p>
      ) : !data?.connected ? (
        <p className="text-sm text-muted-foreground">Klaviyo isn't connected.</p>
      ) : !data.ok ? (
        <p className="text-destructive text-sm flex items-center gap-1">
          <AlertCircle className="w-4 h-4" /> {data.message}
        </p>
      ) : s && (
        <>
          <div>
            <p className="text-2xl font-display font-bold">{gbp(s.revenue)}</p>
            <p className="text-xs text-muted-foreground">
              {orders(s.orders)}{salesPct != null ? ` · ${salesPct}% of total sales` : ""}
            </p>
          </div>

          {s.revenue > 0 && flowPct != null && (
            <div
              className="flex h-2.5 w-full overflow-hidden rounded-full bg-sky-500/70"
              role="img"
              aria-label={`${flowPct}% flows, ${100 - flowPct}% campaigns`}
            >
              <div className="h-full bg-primary" style={{ width: `${flowPct}%` }} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-primary" /> Flows{flowPct != null ? ` · ${flowPct}%` : ""}
              </p>
              <p className="text-lg font-display font-bold">{gbp(s.flows.revenue)}</p>
              <p className="text-xs text-muted-foreground">{orders(s.flows.orders)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-sky-500/70" /> Campaigns{flowPct != null ? ` · ${100 - flowPct}%` : ""}
              </p>
              <p className="text-lg font-display font-bold">{gbp(s.campaigns.revenue)}</p>
              <p className="text-xs text-muted-foreground">{orders(s.campaigns.orders)}</p>
            </div>
          </div>

          {s.byFlow.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
                {open ? "Hide" : "Show"} each flow ({s.byFlow.length})
              </button>
              {open && (
                <ul className="mt-2 divide-y divide-border/60">
                  {s.byFlow.map(f => (
                    <li key={f.flowId} className="py-1.5 flex items-baseline justify-between gap-3 text-sm">
                      <span>{f.name}</span>
                      <span className="shrink-0 tabular-nums">
                        <span className="font-semibold">{gbp(f.revenue)}</span>
                        <span className="text-muted-foreground"> · {orders(f.orders)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
