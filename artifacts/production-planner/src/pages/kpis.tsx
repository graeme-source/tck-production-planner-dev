/**
 * Analytics → KPIs (Graeme, 17 Nov 2026: "KPIs are scattered ... I don't know
 * where to go to see KPIs"). One page: pick a KPI (or All KPIs), pick a date
 * range, see it over time, and edit its targets beside it. Replaces the
 * separate Production KPIs, Team efficiency and Defects & waste entries and
 * Analytics' own Production KPIs tab — their old addresses land here
 * (lib/kpis-page.ts → legacyKpiHref). Viewing only: every figure comes from
 * the KPI's existing endpoint. Objective G.
 */
import { useLocation, useSearch } from "wouter";
import { AlertOctagon, Boxes, Factory, Gauge, LayoutGrid, Layers, Package, Target, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { PeriodPicker, usePeriodChoice } from "@/components/period-picker";
import { RoomKpiCard } from "@/components/room-kpi-card";
import { WrappingSpeedReport } from "@/components/wrapping-speed-report";
import { KpiOverview } from "@/components/kpis/kpi-overview";
import { PackingTrend, TrendCard, WrappingTrend } from "@/components/kpis/kpi-trends";
import { RunRateView } from "@/components/kpis/run-rate-view";
import { PackingSpeedReport } from "@/components/kpis/packing-speed-report";
import { AllTargets, StationTargetCard } from "@/components/kpis/all-targets";
import { kpiHref, parseKpiView, visibleKpiViews, type KpiViewId } from "@/lib/kpis-page";
import TeamEfficiencyPage from "@/pages/team-efficiency";
import DefectsPage from "@/pages/defects";

const ICONS: Record<KpiViewId, LucideIcon> = {
  overview: LayoutGrid,
  "run-rate": Factory,
  room: Boxes,
  packing: Package,
  wrapping: Layers,
  efficiency: Gauge,
  defects: AlertOctagon,
  targets: Target,
};

export default function KpisPage() {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  const isManagerOrAdmin = role === "admin" || role === "manager";
  const search = useSearch();
  const [, navigate] = useLocation();
  const views = visibleKpiViews(isManagerOrAdmin);
  const asked = parseKpiView(search);
  const view = views.find(v => v.id === asked) ?? views[0];
  // Opens on Today (Graeme, 26 Nov 2026) — pick a longer range for the trend.
  const picker = usePeriodChoice("today");
  const { from, to } = picker.period;
  const open = (id: KpiViewId) => navigate(kpiHref(id));

  return (
    <div className="space-y-6">
      <PageHeader title="KPIs" />

      {/* Which KPI — wraps to as many rows as the screen needs. */}
      <nav aria-label="KPIs" className="flex flex-wrap gap-2">
        {views.map(v => {
          const Icon = ICONS[v.id];
          const active = v.id === view.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => open(v.id)}
              aria-current={active ? "page" : undefined}
              title={v.unit}
              className={cn(
                "flex items-center gap-1.5 rounded-xl border-2 px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors",
                active ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-card hover:bg-secondary/60",
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {v.name}
            </button>
          );
        })}
      </nav>

      {view.usesPageRange && (
        <PeriodPicker {...picker} />
      )}

      {view.id === "overview" && <KpiOverview from={from} to={to} onOpen={open} />}
      {view.id === "run-rate" && <RunRateView fromDate={from} toDate={to} />}
      {view.id === "room" && (
        <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          <RoomKpiCard />
          <StationTargetCard kpiKey="packing" />
          <StationTargetCard kpiKey="wrapping" />
        </div>
      )}
      {view.id === "packing" && (
        <div className="space-y-6">
          <TrendCard id="packing"><PackingTrend from={from} to={to} /></TrendCard>
          <div className="grid gap-5 md:grid-cols-2"><StationTargetCard kpiKey="packing" /></div>
          <PackingSpeedReport fromDate={from} toDate={to} />
        </div>
      )}
      {view.id === "wrapping" && (
        <div className="space-y-6">
          <TrendCard id="wrapping"><WrappingTrend from={from} to={to} /></TrendCard>
          <div className="grid gap-5 md:grid-cols-2"><StationTargetCard kpiKey="wrapping" /></div>
          <WrappingSpeedReport fromDate={from} toDate={to} />
        </div>
      )}
      {view.id === "efficiency" && <TeamEfficiencyPage embedded />}
      {view.id === "defects" && <DefectsPage embedded />}
      {view.id === "targets" && <AllTargets />}
    </div>
  );
}
