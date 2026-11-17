/**
 * Analytics → KPIs → All targets: every production KPI's target in one place
 * (was the Analytics → Production KPIs page, 13 Nov 2026; folded into the
 * KPIs page 17 Nov 2026 — /analytics/production-kpis lands here). Each KPI's
 * own tab shows the same card beside its figures. Objective G.
 */
import { Gauge, Lock } from "lucide-react";
import { useProductionKpis } from "@/hooks/use-production-kpis";
import { PRODUCTION_KPI_INFO } from "@/lib/production-kpis";
import { RoomKpiCard } from "@/components/room-kpi-card";
import { EditableKpiCard, FixedCard } from "./station-target-cards";
import { RunRateSettings } from "./run-rate-settings";

export function StationTargetCard({ kpiKey }: { kpiKey: "packing" | "wrapping" }) {
  const { kpis, data } = useProductionKpis();
  const info = PRODUCTION_KPI_INFO.find(i => i.key === kpiKey);
  if (!info) return null;
  return <EditableKpiCard info={info} kpi={kpis[kpiKey]} canEdit={data?.canEdit === true} />;
}

export function AllTargets() {
  const { kpis, data, isLoading, isError } = useProductionKpis();
  const canEdit = data?.canEdit === true;

  return (
    <div className="space-y-5">
      {isError && <p className="text-red-600 font-semibold">Couldn't load the stored figures — showing the defaults.</p>}
      {!canEdit && !isLoading && (
        <p className="flex items-center gap-2 text-muted-foreground"><Lock className="w-4 h-4" /> Only Graeme can change the packing and wrapping targets.</p>
      )}
      <RunRateSettings />
      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
        <RoomKpiCard />
        {PRODUCTION_KPI_INFO.map(info => (
          <EditableKpiCard key={info.key} info={info} kpi={kpis[info.key]} canEdit={canEdit} />
        ))}
        <FixedCard icon={Gauge} name="Dough Prep and Prepping For" unit="no KPI yet" value="—">
          <p>Their dashboard tiles stay grey until a target is agreed.</p>
        </FixedCard>
      </div>
    </div>
  );
}
