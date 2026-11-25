// The profit tracker on the founder P&L page (Graeme, 18 Nov 2026;
// Objective I). "In the last 2 weeks, we're pretty sure this is the profit
// we're making": the predicted P&L for any days, laid out like QuickBooks,
// then every order costed under the same rules.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PeriodPicker, usePeriodChoice } from "@/components/period-picker";
import { fetchPrediction, gbp0, pct } from "./profit-tracker-api";
import { OrderAnalysis } from "./order-analysis";

// Every order in the period is costed one by one, so the server works out at
// most 93 days at a time (Last 3 months always fits).
const TOO_LONG = "up to 3 months at a time";
const LONG_PERIODS_OFF = { last6Months: TOO_LONG, last12Months: TOO_LONG } as const;

export function ProfitTrackerCard() {
  // The standard period picker, as on Numbers (Graeme, 25 Nov 2026). It
  // used to open on its own "Last 14 days"; the nearest standard period is
  // Last 7 days (seven finished days ending yesterday).
  const picker = usePeriodChoice("last7");
  const { period } = picker;

  const { data, isLoading, error } = useQuery({
    queryKey: ["pnl-tracker-predict", period.from, period.to],
    queryFn: () => fetchPrediction(period.from, period.to),
    staleTime: 5 * 60 * 1000,
    enabled: !period.empty,
  });

  const amount = (k: string) => data?.pnl.lines.find(l => l.key === k)?.amount ?? 0;
  const income = data?.pnl.income ?? 0;
  const share = (n: number) => (income ? `${((n / income) * 100).toFixed(1)}% of income` : undefined);

  return (
    <section className="space-y-4">
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="p-5 space-y-4 border-b border-border">
          <div>
            <h2 className="text-lg font-display font-bold">Profit tracker</h2>
            <p className="text-sm text-muted-foreground">
              Predicted from our costings
              {data ? ` · ${data.pnl.orders.toLocaleString("en-GB")} orders, ${data.pnl.packs.toLocaleString("en-GB")} packs` : ""}
            </p>
          </div>
          <PeriodPicker {...picker} disabled={LONG_PERIODS_OFF} />
        </div>

        {error && (
          <p className="m-5 p-4 rounded-xl bg-destructive/5 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />{error instanceof Error ? error.message : "Couldn't work it out"}
          </p>
        )}

        <div className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { title: "Income", value: income, sub: data ? `${gbp0.format(data.pnl.orders ? income / data.pnl.orders : 0)} an order` : undefined },
            { title: "Gross profit", value: amount("gross_profit"), sub: share(amount("gross_profit")) },
            { title: "After advertising", value: amount("after_advertising"), sub: share(amount("after_advertising")) },
            { title: "Net profit", value: amount("net_profit"), sub: share(amount("net_profit")) },
          ].map(k => (
            <div key={k.title} className="rounded-2xl bg-secondary/40 p-5">
              <p className="text-sm font-medium text-muted-foreground">{k.title}</p>
              {isLoading ? <Skeleton className="h-8 w-28 mt-2" /> : (
                <p className={`text-2xl font-display font-bold mt-1 ${k.value < 0 ? "text-red-600" : ""}`}>{data ? gbp0.format(k.value) : "—"}</p>
              )}
              {k.sub && <p className="text-xs text-muted-foreground mt-1">{k.sub}</p>}
            </div>
          ))}
        </div>

        {data && (data.pnl.uncostedItems > 0 || data.pnl.labourSource === "estimate") && (
          <div className="mx-5 mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-sm text-amber-900 dark:text-amber-200 space-y-1">
            {data.pnl.uncostedItems > 0 && <p>{data.pnl.uncostedItems} items have no recipe or Shopify cost, so their food isn't counted.</p>}
            {data.pnl.labourSource === "estimate" && <p>Planday couldn't be read, so labour is QuickBooks' recent share of income.</p>}
          </div>
        )}

        {isLoading ? (
          <div className="px-5 pb-5 space-y-2">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
        ) : data ? (
          <div className="px-5 pb-5">
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm tabular-nums">
                <thead className="bg-secondary/50">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2" />
                    <th className="text-right font-semibold px-3 py-2">£</th>
                    <th className="text-right font-semibold px-3 py-2">% of income</th>
                    <th className="text-right font-semibold px-3 py-2">Per order</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pnl.lines.map(l => {
                    const total = ["gross_profit", "after_advertising", "operating_profit", "net_profit", "income"].includes(l.key);
                    return (
                      <tr key={l.key} className={`border-t border-border ${total ? "bg-secondary/30 font-semibold" : ""}`}>
                        <td className="px-3 py-2">{l.label}</td>
                        <td className={`text-right px-3 py-2 ${total && l.amount < 0 ? "text-red-600" : ""}`}>{gbp0.format(l.amount)}</td>
                        <td className="text-right px-3 py-2 text-muted-foreground">{income ? pct((l.amount / income) * 100) : "—"}</td>
                        <td className="text-right px-3 py-2 text-muted-foreground">{data.pnl.orders ? gbp0.format(l.amount / data.pnl.orders) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-primary font-medium">How each line is worked out</summary>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {data.pnl.lines.map(l => <li key={l.key}><span className="font-medium text-foreground">{l.label}:</span> {l.how}</li>)}
              </ul>
            </details>
          </div>
        ) : null}
      </div>

      {data && <OrderAnalysis data={data} />}
    </section>
  );
}
