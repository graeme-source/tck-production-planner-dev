/**
 * Email revenue this month, and the last five emails (Graeme, 10 Nov 2026).
 * Objective I. Replaces Revenue pace and Email cadence at the top of the
 * Marketing Calendar.
 *
 *   Top     Klaviyo's email revenue for the month so far, its share of store
 *           sales (Shopify, the page's own month-to-date), flows vs campaigns
 *           — GET /api/klaviyo-email-revenue, the same figures as Order
 *           Analysis on Numbers.
 *   Table   The last five emails sent: name, when, revenue, open, click and
 *           placed-order rate — Klaviyo's campaign results, as the calendar
 *           shows them (GET /api/marketing-calendar/klaviyo-emails).
 */
import type { ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { AlertCircle, Mail } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useEmailRevenue } from "@/components/email-revenue-card";
import { useCalendarEmails } from "./api";
import { daysBefore, lastSent, monthToDateRange, sharePercent } from "@/lib/email-revenue-panel";

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export function EmailRevenuePanel({ storeSales, connected, footer }: {
  /** Store sales this month so far (Shopify), for the share. */
  storeSales: number | null | undefined;
  /** Klaviyo connected (the page's pulse knows). */
  connected: boolean;
  /** Connect / disconnect Klaviyo — the founder's controls. */
  footer?: ReactNode;
}) {
  const { from, to } = monthToDateRange();
  const revenue = useEmailRevenue(from, to);
  const emails = useCalendarEmails(daysBefore(to, 60), to);
  const r = revenue.data && revenue.data.connected && revenue.data.ok ? revenue.data.split : null;
  const share = sharePercent(r?.revenue, storeSales);
  const flowPct = r && r.revenue > 0 ? Math.round((r.flows.revenue / r.revenue) * 100) : null;
  const recent = lastSent(emails.data?.emails ?? []);

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Mail className="w-4 h-4 text-primary" /> Email revenue — this month
        <span className="text-xs font-normal text-muted-foreground">from Klaviyo</span>
      </h2>

      {!connected ? (
        footer ?? <p className="text-sm text-muted-foreground">Klaviyo isn't connected yet — Graeme connects it.</p>
      ) : (
        <>
          {revenue.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : !r ? (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="w-4 h-4" />
              {revenue.data && "message" in revenue.data ? revenue.data.message : "Couldn't load Klaviyo's revenue just now"}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 items-center">
              <div>
                <p className="text-3xl font-display font-bold tabular-nums leading-tight">{gbp(r.revenue)}</p>
                <p className="text-sm text-muted-foreground">
                  {share != null ? <><span className="font-semibold text-foreground">{share}%</span> of store sales ({gbp(storeSales!)})</> : "Store sales not loaded"}
                </p>
              </div>
              <div className="space-y-1.5 min-w-0">
                <div
                  className="flex h-3 w-full overflow-hidden rounded-full bg-sky-500/70"
                  role="img"
                  aria-label={flowPct != null ? `${flowPct}% flows, ${100 - flowPct}% campaigns` : "No email revenue yet"}
                >
                  {flowPct != null && <div className="h-full bg-primary" style={{ width: `${flowPct}%` }} />}
                </div>
                <div className="flex flex-wrap justify-between gap-x-4 text-sm">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-primary" />
                    Flows <span className="font-semibold tabular-nums">{gbp(r.flows.revenue)}</span>
                    {flowPct != null && <span className="text-muted-foreground">· {flowPct}%</span>}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-sky-500/70" />
                    Campaigns <span className="font-semibold tabular-nums">{gbp(r.campaigns.revenue)}</span>
                    {flowPct != null && <span className="text-muted-foreground">· {100 - flowPct}%</span>}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* The last five sent — one compact row each. */}
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left font-semibold py-1.5 px-1">Last 5 emails</th>
                  <th className="text-left font-semibold py-1.5 px-1 whitespace-nowrap">Sent</th>
                  <th className="text-right font-semibold py-1.5 px-1">Revenue</th>
                  <th className="text-right font-semibold py-1.5 px-1">Open</th>
                  <th className="text-right font-semibold py-1.5 px-1">Click</th>
                  <th className="text-right font-semibold py-1.5 px-1 whitespace-nowrap">Placed order</th>
                </tr>
              </thead>
              <tbody>
                {emails.isLoading ? (
                  <tr><td colSpan={6} className="py-2"><Skeleton className="h-5 w-full" /></td></tr>
                ) : recent.length === 0 ? (
                  <tr><td colSpan={6} className="py-2 text-muted-foreground">{emails.data?.error ?? "No emails sent in the last 60 days."}</td></tr>
                ) : recent.map((e) => {
                  const res = e.results;
                  return (
                    <tr key={e.id} className="border-b border-border/60 last:border-0">
                      <td className="py-1.5 px-1 min-w-[12rem]">
                        <a href={e.klaviyoUrl} target="_blank" rel="noreferrer" className="hover:underline">{e.name}</a>
                      </td>
                      <td className="py-1.5 px-1 whitespace-nowrap text-muted-foreground tabular-nums">{format(parseISO(e.sendAt!), "EEE d MMM, HH:mm")}</td>
                      <td className="py-1.5 px-1 text-right font-semibold tabular-nums">{res ? gbp(res.revenue) : "—"}</td>
                      <td className="py-1.5 px-1 text-right tabular-nums">{res ? pct(res.openRate) : "—"}</td>
                      <td className="py-1.5 px-1 text-right tabular-nums">{res ? pct(res.clickRate) : "—"}</td>
                      <td className="py-1.5 px-1 text-right tabular-nums">{res ? pct(res.orderRate) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {footer}
        </>
      )}
    </section>
  );
}
