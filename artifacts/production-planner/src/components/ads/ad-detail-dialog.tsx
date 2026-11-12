/**
 * Everything about one campaign, ad set or ad for the period. Closable (X,
 * backdrop, Escape), max-h-[92dvh] with internal scrolling.
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { count, money, ratePct, reachPctText, roasText, type AdGrade, type AdLevel, type AdRow } from "@/lib/ads-page";
import type { RoasShade } from "@/lib/ad-efficiency";

const LEVEL_NAME: Record<AdLevel, string> = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };

function Stat({ label, value, shade }: { label: string; value: string; shade?: RoasShade | null }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <p className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">
        {shade && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: shade.hex }} />}
        {label}
      </p>
      <p className="text-xl font-display font-bold tabular-nums">{value}</p>
    </div>
  );
}

const budgetText = (row: AdRow) =>
  row.dailyBudget != null ? `${money(row.dailyBudget)} a day`
    : row.lifetimeBudget != null ? `${money(row.lifetimeBudget)} in total`
      : null;

export function AdDetailDialog({ row, grade, newShade = null, periodLabel, onClose }: {
  row: AdRow;
  grade: AdGrade;
  newShade?: RoasShade | null;
  periodLabel: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const budget = budgetText(row);
  return createPortal(
    <div className="fixed inset-0 z-[130] bg-black/70 flex items-center justify-center p-3 md:p-8" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ad-detail-title"
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden text-left text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={cn("flex items-start gap-3 px-5 py-4", grade.overall ? (grade.overall.darkBackground ? "text-white" : "text-stone-900") : "bg-secondary")}
          style={grade.overall ? { backgroundColor: grade.overall.hex } : undefined}
        >
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium opacity-90">{LEVEL_NAME[row.level]} · {periodLabel}</p>
            <h2 id="ad-detail-title" className="font-display font-bold text-xl leading-tight break-words">{row.name}</h2>
            {row.level !== "campaign" && row.campaignName && <p className="text-sm opacity-90 mt-1 break-words">Campaign: {row.campaignName}</p>}
            {row.level === "ad" && row.adSetName && <p className="text-sm opacity-90 break-words">Ad set: {row.adSetName}</p>}
          </div>
          <button onClick={onClose} className="p-2 -m-1 rounded-lg hover:bg-black/10" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Stat label="Cost per result" value={money(row.costPerResult)} shade={grade.costPerResult} />
            <Stat label="Purchase ROAS" value={roasText(row.roas)} shade={grade.roas} />
            <Stat label="Cost per reach" value={reachPctText(row.costPerReachPct)} shade={grade.costPerReach} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="Spent" value={money(row.spend)} />
            <Stat label="Results" value={count(row.purchases)} />
            <Stat label="Purchase value" value={money(row.purchaseValue)} />
            <Stat label="Reach" value={count(row.reach)} />
            <Stat label="Impressions" value={count(row.impressions)} />
            <Stat label="Frequency" value={row.frequency == null ? "—" : row.frequency.toFixed(2)} />
            <Stat label="Link clicks" value={count(row.linkClicks)} />
            <Stat label="CTR" value={row.ctr == null ? "—" : `${row.ctr.toFixed(2)}%`} />
            <Stat label="CPM" value={money(row.cpm)} />
            {budget && <Stat label="Budget" value={budget} />}
          </div>
          {/* New customers, as Meta splits them (Graeme, 12 Nov 2026). */}
          {row.newCustomerSpend != null && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat label="New-customer ROAS" value={roasText(row.newCustomerRoas)} shade={newShade} />
                <Stat label="New-customer purchases" value={count(row.newCustomerPurchases)} />
                <Stat label="Spent on new customers" value={money(row.newCustomerSpend)} />
                <Stat label="Spent on existing" value={money(Math.max(0, row.spend - row.newCustomerSpend))} />
              </div>
              <p className="text-xs text-muted-foreground">
                Meta's estimate: people it didn't match to your existing-customer list. An existing customer it can't match counts as new.
              </p>
            </div>
          )}
          {/* Hook and hold (Graeme, 12 Nov 2026): how many stop on the video,
              and how many stay with it. Video ads only. */}
          {row.level === "ad" && (
            row.hookRatePct != null || row.holdRatePct != null ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Hook rate" value={ratePct(row.hookRatePct)} />
                  <Stat label="Hold rate" value={ratePct(row.holdRatePct)} />
                  <Stat label="3-second plays" value={count(row.videoPlays3s)} />
                  <Stat label="ThruPlays" value={count(row.thruPlays)} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Hook rate: 3-second plays ÷ impressions. Hold rate: ThruPlays (played to the end, or 15 seconds) ÷ impressions.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No video plays in this period, so no hook or hold rate — a static ad, or one that hasn't shown yet.</p>
            )
          )}
          {row.status === "WITH_ISSUES" && (
            <p className="text-sm text-amber-700 dark:text-amber-400">Meta has flagged an issue on this one. It's still spending.</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
