/**
 * Business → Ads (Graeme, 6 Nov 2026): the live Meta campaigns, ad sets and
 * ads side by side, coloured against his targets, so a glance replaces a trip
 * to Ads Manager. Tap one for its figures. Read-only. Objective I.
 *
 * Colours: lib/ads-page.ts. Feed: lib/meta-ads-report.ts on the server.
 * Targets live with the Numbers ones, in numbers_benchmarks.
 */
import { useState } from "react";
import { Redirect } from "wouter";
import { format } from "date-fns";
import { AlertCircle, Loader2, RefreshCw, Target } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { FounderNav } from "@/components/founder-nav";
import { describePeriod, PeriodPicker, usePeriodChoice } from "@/components/period-picker";
import { useNumbersBenchmarks } from "@/components/numbers-benchmarks/api";
import { BenchmarksDialog } from "@/components/numbers-benchmarks/benchmarks-dialog";
import { AdCard } from "@/components/ads/ad-card";
import { AdDetailDialog } from "@/components/ads/ad-detail-dialog";
import { useAdsReport } from "@/components/ads/api";
import { useFounderArea } from "@/hooks/use-founder-area";
import { cn } from "@/lib/utils";
import { gradeAd, type AdRow } from "@/lib/ads-page";

export default function FounderAds() {
  const { ready, canNumbers, home } = useFounderArea();
  if (!ready) return null;
  if (!canNumbers) return <Redirect to={home ?? "/"} />;
  return <AdsPage />;
}

function AdsPage() {
  // Today first (Graeme, 6 Nov 2026): this page is for what the ads are doing now.
  const picker = usePeriodChoice("today");
  const { period } = picker;
  const report = useAdsReport(period.from, period.to, !period.empty);
  const { data: targets } = useNumbersBenchmarks();
  const [open, setOpen] = useState<AdRow | null>(null);
  const [editing, setEditing] = useState(false);
  const canEdit = !!targets?.canEdit;
  const data = report.data;
  const live = data?.connected && data.ok ? data : null;

  const column = (title: string, rows: AdRow[]) => (
    <section className="min-w-0 space-y-3">
      <h2 className="flex items-baseline gap-2 whitespace-nowrap text-2xl lg:text-3xl font-display font-extrabold text-foreground leading-tight">
        {title} <span className="text-lg lg:text-xl font-semibold text-muted-foreground tabular-nums">{rows.length}</span>
      </h2>
      {rows.map(row => (
        <AdCard
          key={row.id}
          row={row}
          grade={gradeAd(row, targets?.benchmarks)}
          canEdit={canEdit}
          onOpen={() => setOpen(row)}
          onEditTargets={() => setEditing(true)}
        />
      ))}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing live.</p>}
    </section>
  );

  return (
    <div className="space-y-4">
      <FounderNav />
      <PageHeader title="Ads" description="Live campaigns, ad sets and ads from Meta." />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {period.id === "custom" ? "Custom range" : period.label}
          {live && ` · updated ${format(new Date(live.fetchedAt), "HH:mm")}`}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void report.refresh()}
            disabled={report.refreshing}
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border-2 border-border bg-card hover:bg-secondary/60 disabled:opacity-60"
          >
            <RefreshCw className={cn("w-4 h-4 text-primary", report.refreshing && "animate-spin")} /> Refresh
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border-2 border-border bg-card hover:bg-secondary/60"
            >
              <Target className="w-4 h-4 text-primary" /> Targets
            </button>
          )}
        </div>
      </div>

      <PeriodPicker {...picker}>
        {report.isFetching && !report.refreshing && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </PeriodPicker>

      {report.isError && <Problem text="Couldn't load the ads. Try Refresh in a moment." />}
      {data && "message" in data && <Problem text={data.message} />}

      {live ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          {column("Campaigns", live.campaigns)}
          {column("Ad sets", live.adSets)}
          {column("Ads", live.ads)}
        </div>
      ) : !data && !report.isError && (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      )}

      {open && (
        <AdDetailDialog row={open} grade={gradeAd(open, targets?.benchmarks)} periodLabel={describePeriod(period)} onClose={() => setOpen(null)} />
      )}
      {editing && <BenchmarksDialog ads onClose={() => setEditing(false)} />}
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm flex items-center gap-2">
      <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-600" /> {text}
    </p>
  );
}

