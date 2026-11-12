/**
 * Business → Ads (Graeme, 6 Nov 2026): the live Meta campaigns, ad sets and
 * ads side by side, coloured against his targets, so a glance replaces a trip
 * to Ads Manager. Tap one for its figures. Read-only. Objective I.
 *
 * Colours: lib/ads-page.ts. Feed: lib/meta-ads-report.ts on the server.
 * Targets live with the Numbers ones, in numbers_benchmarks.
 */
import { useState, type ReactNode } from "react";
import { Redirect } from "wouter";
import { format } from "date-fns";
import { AlertCircle, Loader2, RefreshCw, Target } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { FounderNav } from "@/components/founder-nav";
import { describePeriod, PeriodPicker, usePeriodChoice } from "@/components/period-picker";
import { useNumbersBenchmarks } from "@/components/numbers-benchmarks/api";
import { BenchmarksDialog } from "@/components/numbers-benchmarks/benchmarks-dialog";
import { AdCard, type AdLevel } from "@/components/ads/ad-card";
import { AccountPanel } from "@/components/ads/account-panel";
import { AdDetailDialog } from "@/components/ads/ad-detail-dialog";
import { useAdsReport } from "@/components/ads/api";
import { useFounderArea } from "@/hooks/use-founder-area";
import { cn } from "@/lib/utils";
import { gradeAd, gradeNewCustomerRoas, groupAds, type AdRow, type CampaignGroup } from "@/lib/ads-page";

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

  const card = (row: AdRow, level: AdLevel = "ad") => (
    <AdCard
      key={row.id}
      row={row}
      level={level}
      grade={gradeAd(row, targets?.benchmarks)}
      newShade={gradeNewCustomerRoas(row.newCustomerRoas, targets?.benchmarks)}
      canEdit={canEdit}
      onOpen={() => setOpen(row)}
      onEditTargets={() => setEditing(true)}
    />
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

      {live?.account && (
        <AccountPanel
          figures={live.account}
          grade={gradeAd(live.account, targets?.benchmarks)}
          shopify={live.shopifyNewCustomers ?? null}
          shopifyShade={gradeNewCustomerRoas(live.shopifyNewCustomers?.roas, targets?.benchmarks)}
          periodLabel={describePeriod(period)}
        />
      )}

      {live ? (
        <AdFolders
          groups={groupAds(live.campaigns, live.adSets, live.ads)}
          counts={{ campaigns: live.campaigns.length, adSets: live.adSets.length, ads: live.ads.length }}
          card={card}
        />
      ) : !data && !report.isError && (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      )}

      {open && (
        <AdDetailDialog row={open} grade={gradeAd(open, targets?.benchmarks)} newShade={gradeNewCustomerRoas(open.newCustomerRoas, targets?.benchmarks)} periodLabel={describePeriod(period)} onClose={() => setOpen(null)} />
      )}
      {editing && <BenchmarksDialog ads onClose={() => setEditing(false)} />}
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function ColumnTitle({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="flex items-baseline gap-2 whitespace-nowrap text-2xl lg:text-3xl font-display font-extrabold text-foreground leading-tight">
      {title} <span className="text-lg lg:text-xl font-semibold text-muted-foreground tabular-nums">{count}</span>
    </h2>
  );
}

/** A parent that isn't on the page itself, so its children still have a home. */
function NotLive({ name, what }: { name: string | null; what: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-4 py-3">
      <p className="font-display font-bold leading-snug break-words text-muted-foreground">{name ?? `Unknown ${what}`}</p>
      <p className="text-xs text-muted-foreground mt-0.5">This {what} isn't live</p>
    </div>
  );
}

/**
 * Folders (Graeme, 6 Nov 2026): a band per campaign, with a strong line above
 * it, and inside it a row per ad set holding its ads, so the next one doesn't
 * start until the last has finished. The inner grid's columns line up with
 * the outer three. Parents stick while their children scroll past. One
 * column on a phone, with the children stepped in.
 */
function AdFolders({ groups, counts, card }: {
  groups: CampaignGroup[];
  counts: { campaigns: number; adSets: number; ads: number };
  card: (row: AdRow, level?: AdLevel) => ReactNode;
}) {
  return (
    <div>
      <div className="hidden md:grid grid-cols-3 gap-4 pb-3">
        <ColumnTitle title="Campaigns" count={counts.campaigns} />
        <ColumnTitle title="Ad sets" count={counts.adSets} />
        <ColumnTitle title="Ads" count={counts.ads} />
      </div>
      <p className="md:hidden pb-3 text-sm font-semibold text-muted-foreground">
        {plural(counts.campaigns, "campaign")} · {plural(counts.adSets, "ad set")} · {plural(counts.ads, "ad")}
      </p>
      {groups.map(group => (
        <section key={group.key} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start border-t-4 border-foreground/50 py-5">
          <div className="min-w-0 md:sticky md:top-2 md:z-10">
            {group.campaign ? card(group.campaign, "campaign") : <NotLive name={group.name} what="campaign" />}
          </div>
          <div className="md:col-span-2 min-w-0 space-y-4 pl-3 md:pl-0 border-l-2 md:border-l-0 border-border">
            {group.adSets.map((set, i) => (
              <div key={set.key} className={cn("grid grid-cols-1 md:grid-cols-2 gap-4 items-start", i > 0 && "border-t border-border pt-4")}>
                <div className="min-w-0 md:sticky md:top-2 md:z-10">
                  {set.adSet ? card(set.adSet, "adSet") : <NotLive name={set.name} what="ad set" />}
                </div>
                <div className="min-w-0 space-y-3 pl-3 md:pl-0 border-l-2 md:border-l-0 border-border">
                  {set.ads.map(ad => card(ad))}
                  {set.ads.length === 0 && <p className="text-sm text-muted-foreground">No live ads.</p>}
                </div>
              </div>
            ))}
            {group.adSets.length === 0 && <p className="text-sm text-muted-foreground">No live ad sets.</p>}
          </div>
        </section>
      ))}
      {groups.length === 0 && <p className="text-sm text-muted-foreground">Nothing live.</p>}
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

