// Founder P&L (/founder/pnl). Objective I (finance & reporting).
//
// Since 18 Nov 2026 the page is QuickBooks first: the real Profit and Loss
// by Month, then the profit tracker (predicted P&L from our costings, every
// order costed), predicted vs QuickBooks, and the tracker's prices and
// grouping. The old Shopify-only estimate (VAT-inclusive revenue, no
// courier, a typed £30,000 overhead) and its overheads list were removed at
// Graeme's request; the /api/pnl routes behind them are left in place.
import { Redirect } from "wouter";
import { useFounderArea } from "@/hooks/use-founder-area";
import { PageHeader } from "@/components/page-header";
import { FounderNav } from "@/components/founder-nav";
import { PnlByMonthCard } from "@/components/founder/pnl-by-month-card";
import { ProfitTrackerCard } from "@/components/founder/profit-tracker-card";
import { PredictedVsActual, TrackerSetup } from "@/components/founder/tracker-calibration";

export default function FounderPnL() {
  // Founder only — not grantable. A Business grantee who types the URL
  // lands on a tab they can open instead of a page of 403s.
  const { ready, isFounder, home } = useFounderArea();
  if (!ready) return null;
  if (!isFounder) return <Redirect to={home ?? "/"} />;
  return (
    <div className="space-y-6">
      <FounderNav />
      <PageHeader title="P&L" description="QuickBooks month by month, and what our costings say we're making now" />
      <PnlByMonthCard />
      <ProfitTrackerCard />
      <PredictedVsActual />
      <TrackerSetup />
    </div>
  );
}
