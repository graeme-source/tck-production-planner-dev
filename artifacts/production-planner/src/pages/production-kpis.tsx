/**
 * Analytics → Production KPIs (Graeme, 13 Nov 2026: "Where is this set? Is
 * there a place I can look at all my production KPIs?"). Every station's
 * target in one place. Packing and wrapping are set here (founder only,
 * autosaved) and read by the dashboard tiles, the wrapping station and the
 * packing screen. The line run rate and the builders' table targets are
 * shown with where they're set. Objective G.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useListTimingStandards } from "@workspace/api-client-react";
import { BUILDING_TARGET_BATCHES_PER_HOUR } from "@workspace/production-schedule";
import { Gauge, Package, Layers, Factory, Hammer, Lock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SaveChip } from "@/components/save-chip";
import { useAutosave } from "@/hooks/use-autosave";
import { useProductionKpis, PRODUCTION_KPIS_KEY } from "@/hooks/use-production-kpis";
import {
  PRODUCTION_KPI_INFO, amberFrom, kpiProblem,
  type ProductionKpi, type ProductionKpiInfo, type ProductionKpiKey,
} from "@/lib/production-kpis";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const ICONS: Record<ProductionKpiKey, typeof Gauge> = { packing: Package, wrapping: Layers };

async function saveKpi(key: ProductionKpiKey, kpi: ProductionKpi): Promise<void> {
  const res = await fetch(`${BASE}/api/production-kpis/${key}`, {
    method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(kpi),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? data.details?.fieldErrors?.stretch?.[0] ?? "Couldn't save");
  }
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function Bands({ kpi }: { kpi: ProductionKpi }) {
  return (
    <div className="flex flex-wrap gap-2 text-sm font-semibold">
      {kpi.stretch != null && <span className="px-3 py-1 rounded-full bg-purple-600 text-white">{fmt(kpi.stretch)}+ smashing it</span>}
      <span className="px-3 py-1 rounded-full bg-[#7cb342] text-white">{fmt(kpi.standard)}+ on target</span>
      <span className="px-3 py-1 rounded-full bg-yellow-400 text-stone-900">{fmt(amberFrom(kpi))}+ close</span>
      <span className="px-3 py-1 rounded-full bg-secondary text-foreground">under {fmt(amberFrom(kpi))} below</span>
    </div>
  );
}

function EditableKpiCard({ info, kpi, canEdit }: { info: ProductionKpiInfo; kpi: ProductionKpi; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [standard, setStandard] = useState(String(kpi.standard));
  const [stretch, setStretch] = useState(kpi.stretch == null ? "" : String(kpi.stretch));
  // Follow the stored figures when they arrive (first load) — never while typing.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return;
    setStandard(String(kpi.standard));
    setStretch(kpi.stretch == null ? "" : String(kpi.stretch));
  }, [kpi.standard, kpi.stretch, touched]);

  const auto = useAutosave<ProductionKpi>(async (v) => {
    await saveKpi(info.key, v);
    await queryClient.invalidateQueries({ queryKey: PRODUCTION_KPIS_KEY });
  });
  const draft: ProductionKpi = { standard: Number(standard), stretch: stretch.trim() === "" ? null : Number(stretch) };
  const problem = kpiProblem(draft.standard, draft.stretch);
  const shown = problem ? kpi : draft;

  const change = (field: "standard" | "stretch", value: string) => {
    setTouched(true);
    const next = field === "standard" ? { ...draft, standard: Number(value) } : { ...draft, stretch: value.trim() === "" ? null : Number(value) };
    if (field === "standard") setStandard(value); else setStretch(value);
    if (!kpiProblem(next.standard, next.stretch)) auto.schedule(next);
  };

  const Icon = ICONS[info.key];
  return (
    <section className="rounded-3xl border-2 border-border bg-card p-5 lg:p-6 space-y-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="w-12 h-12 rounded-2xl bg-[#7cb342]/15 text-[#558b2f] flex items-center justify-center shrink-0"><Icon className="w-6 h-6" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-display font-extrabold">{info.name}</h2>
          <p className="text-muted-foreground">{info.unit}</p>
        </div>
        {canEdit && <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(["standard", "stretch"] as const).map(field => (
          <label key={field} className="rounded-2xl bg-secondary/50 p-4 block">
            <span className="text-sm font-semibold text-muted-foreground">{field === "standard" ? "Standard — on target" : "Stretch — smashing it"}</span>
            {canEdit ? (
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.5"
                value={field === "standard" ? standard : stretch}
                placeholder={field === "stretch" ? "None" : undefined}
                onChange={e => change(field, e.target.value)}
                onBlur={() => void auto.flush()}
                aria-label={`${info.name} ${field}`}
                className="mt-1 w-full bg-background border border-border rounded-xl px-3 py-2 text-3xl font-display font-extrabold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            ) : (
              <span className="mt-1 block text-3xl font-display font-extrabold tabular-nums">
                {field === "standard" ? fmt(kpi.standard) : kpi.stretch == null ? "None" : fmt(kpi.stretch)}
              </span>
            )}
          </label>
        ))}
      </div>
      {problem && touched && <p className="text-sm font-semibold text-red-600">{problem} Not saved.</p>}

      <Bands kpi={shown} />
      <div className="text-sm text-muted-foreground space-y-1">
        <p>{info.measure}</p>
        <p>Shown on: {info.usedOn}</p>
      </div>
    </section>
  );
}

function FixedCard({ icon: Icon, name, unit, value, children }: { icon: typeof Gauge; name: string; unit: string; value: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border-2 border-border bg-card p-5 lg:p-6 space-y-3 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="w-12 h-12 rounded-2xl bg-secondary text-muted-foreground flex items-center justify-center shrink-0"><Icon className="w-6 h-6" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-display font-extrabold">{name}</h2>
          <p className="text-muted-foreground">{unit}</p>
        </div>
        <span className="text-3xl font-display font-extrabold tabular-nums">{value}</span>
      </div>
      <div className="text-sm text-muted-foreground space-y-1">{children}</div>
    </section>
  );
}

export default function ProductionKpisPage() {
  const { kpis, data, isLoading, isError } = useProductionKpis();
  const canEdit = data?.canEdit === true;
  const { data: timing } = useListTimingStandards();
  const builders = (timing ?? []) as Array<{ id: number; stationLabel?: string; targetBatchesPerHour?: number | string; minBatchesPerHour?: number | string }>;

  return (
    <div className="space-y-6">
      <PageHeader title="Production KPIs" description="Every station's target in one place." />
      {isError && <p className="text-red-600 font-semibold">Couldn't load the stored figures — showing the defaults.</p>}
      {!canEdit && !isLoading && (
        <p className="flex items-center gap-2 text-muted-foreground"><Lock className="w-4 h-4" /> Only Graeme can change these.</p>
      )}

      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
        {PRODUCTION_KPI_INFO.map(info => (
          <EditableKpiCard key={info.key} info={info} kpi={kpis[info.key]} canEdit={canEdit} />
        ))}

        <FixedCard icon={Factory} name="Line run rate" unit="batches an hour" value={String(BUILDING_TARGET_BATCHES_PER_HOUR)}>
          <p>Colours the Mixing, Sheeting, Building and Ovens tiles on the dashboard: {Math.round(BUILDING_TARGET_BATCHES_PER_HOUR * 1.1)}+ way ahead, under {Math.round(BUILDING_TARGET_BATCHES_PER_HOUR * 0.9)} too slow.</p>
          <p>It also sets each day's planned finish time, so it isn't changed here — ask Claude.</p>
        </FixedCard>

        <FixedCard icon={Hammer} name="Building tables" unit="batches an hour, per table" value={builders.length ? builders.map(b => fmt(Number(b.targetBatchesPerHour ?? 0))).join(" / ") : "—"}>
          {builders.length ? (
            <ul className="space-y-0.5">
              {builders.map(b => (
                <li key={b.id}>{b.stationLabel ?? "Table"}: target {fmt(Number(b.targetBatchesPerHour ?? 0))}, minimum {fmt(Number(b.minBatchesPerHour ?? 0))}</li>
              ))}
            </ul>
          ) : <p>Not loaded.</p>}
          <p>The pace tile on the building station. Set in <Link href="/settings?section=production" className="font-semibold text-primary underline">Settings → Production</Link>.</p>
        </FixedCard>

        <FixedCard icon={Gauge} name="Dough Prep and Prepping For" unit="no KPI yet" value="—">
          <p>Their dashboard tiles stay grey until a target is agreed.</p>
        </FixedCard>
      </div>
    </div>
  );
}
